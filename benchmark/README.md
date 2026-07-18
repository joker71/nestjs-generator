# Benchmark & Đánh giá code sinh bởi ddd-codegen

Bộ harness đánh giá theo 3 trục của chương thực nghiệm: **đúng đắn** (conformance
matrix), **hiệu năng runtime** (autocannon/k6, 5 biến thể guard), và **scaling
theo tham số mô hình** (model tổng hợp: độ sâu hierarchy, số role/permission).

```
benchmark/
├── harness/          package.json + tsconfig dùng chung cho mọi app build
├── variants/         3 guard baseline: pass / manual (flatten) / casbin
├── scripts/
│   ├── make-variant.js          model .puml → app chạy được (1 biến thể)
│   ├── gen-app-bootstrap.js     sinh main.ts + app.module.ts + auth stub
│   ├── extract-routes.js        trích route + permission từ controller đã sinh
│   ├── gen-conformance-tests.js sinh ma trận test (role × endpoint)
│   ├── sweep-autocannon.mjs     quét (biến thể × endpoint × role) → CSV
│   └── gen-synthetic-model.js   sinh .puml tổng hợp (depth, aggregates, perms)
├── k6/rbac-sweep.js  kịch bản k6 (ramping VUs + thresholds)
├── docker/           Dockerfile chung cho các biến thể
├── docker-compose.yml
├── build/            (sinh ra) app-generated, app-off, ...
└── results/          (sinh ra) CSV/JSON kết quả
```

## 5 biến thể đo

| Biến thể | RBAC | Ý nghĩa trong so sánh |
|---|---|---|
| `off` | Không có decorator/guard | Sàn tuyệt đối của framework |
| `pass` | Guard rỗng return true | Chi phí cơ chế guard (DI + reflector) |
| `generated` | Guard sinh bởi ddd-codegen | **Phương pháp của luận văn** — expand hierarchy mỗi request |
| `manual` | Viết tay, flatten lúc khởi động | Dev cẩn thận tự làm; lookup O(1) |
| `casbin` | node-casbin, cùng policy | Baseline công nghiệp; hierarchy giải lúc enforce |

Phân rã chi phí: `(pass − off)` = cơ chế guard; `(X − pass)` = thuật toán RBAC
của biến thể X. So `generated` với `manual` khi hierarchy sâu → luận cứ cho việc
dời flatten về generation-time.

## Quy trình

### Bước 0 — Cài đặt một lần

```bash
npm install                          # deps của generator (repo root)
```

Cần thêm: Docker (compose v2). k6 không cần cài — chạy qua image `grafana/k6`.

### Bước 1 — Build 4-5 biến thể từ cùng một model

```bash
node benchmark/scripts/make-variant.js --model examples/course-management.puml --variant generated
node benchmark/scripts/make-variant.js --model examples/course-management.puml --variant off
node benchmark/scripts/make-variant.js --model examples/course-management.puml --variant manual
node benchmark/scripts/make-variant.js --model examples/course-management.puml --variant casbin
# tùy chọn: --variant pass
```

Mỗi lệnh: chạy generator → sinh bootstrap (main/app.module/auth-stub) → áp guard
biến thể → chép config harness. Kết quả ở `benchmark/build/app-<variant>/`.

Auth trong benchmark là stub header `x-roles: Admin` (middleware gán
`req.user.roles`) — cô lập chi phí RBAC khỏi chi phí verify JWT. Ghi rõ điều
này trong phần threats-to-validity của luận văn.

### Bước 2 — Conformance test (đúng đắn trước, hiệu năng sau)

```bash
node benchmark/scripts/gen-conformance-tests.js --app benchmark/build/app-generated
cd benchmark/build/app-generated
npm install && npm run test:conformance
```

Sinh ma trận (role × endpoint): kỳ vọng tính từ `ROLE_PERMISSION_MAP` +
`ROLE_HIERARCHY` (RBAC₀ PA + RBAC₁), hành vi thực đo qua supertest — mỗi cặp
một test case ALLOW/DENY-403. Chạy cho cả `manual`/`casbin` để chứng minh các
baseline tương đương ngữ nghĩa (fair comparison), và cho `off` để thấy nó fail
(minh chứng test có răng).

### Bước 3 — Khởi động các biến thể bằng Docker

```bash
cd benchmark
docker compose up --build -d app-generated app-off app-manual app-casbin
# generated:3001  off:3002  manual:3003  casbin:3004  (cpus/mem đã ghim để công bằng)
curl -H "x-roles: Admin" http://localhost:3001/enrollment-context/students   # smoke check
```

### Bước 4 — Sweep autocannon (kết quả chính dạng CSV)

```bash
cd benchmark/build/app-generated && npm install && cd ../../..   # cần autocannon trong devDeps
node benchmark/scripts/sweep-autocannon.mjs \
  --app benchmark/build/app-generated \
  --targets generated=http://localhost:3001,off=http://localhost:3002,manual=http://localhost:3003,casbin=http://localhost:3004 \
  --roles Admin,StudentRole,NONE \
  --duration 15 --warmup 3 --connections 50 \
  --out benchmark/results/autocannon.csv
```

Mỗi ô (biến thể × endpoint × role) chạy warm-up rồi đo: rps, latency mean/p50/
p97.5/p99, non2xx. `role=NONE` đo cả nhánh deny (403 cũng là code path cần đo).
Chạy lặp ≥ 10 lần (cron hoặc vòng for), lấy median + IQR khi vẽ biểu đồ.

### Bước 5 — k6 (kịch bản tải tăng dần + thresholds)

```bash
cd benchmark
docker compose run --rm \
  -e BASE_URL=http://app-generated:3000 \
  -e ENDPOINT=/enrollment-context/students \
  -e METHOD=GET -e ROLES=Admin -e P95_MS=50 \
  k6
# summary JSON → benchmark/results/k6-summary.json
```

autocannon trả lời "throughput/latency tối đa bao nhiêu"; k6 trả lời "dưới tải
tăng dần 20→50→100 VU, p95 có giữ được ngưỡng không" (threshold fail → exit ≠ 0,
dùng được trong CI).

### Bước 6 — Thí nghiệm scaling theo tham số mô hình

```bash
for D in 1 2 4 8 16; do
  node benchmark/scripts/gen-synthetic-model.js --depth $D --aggregates 5 --out benchmark/build/synthetic-d$D.puml
  node benchmark/scripts/make-variant.js --model benchmark/build/synthetic-d$D.puml --variant generated --out benchmark/build/syn-d$D-generated
  node benchmark/scripts/make-variant.js --model benchmark/build/synthetic-d$D.puml --variant casbin    --out benchmark/build/syn-d$D-casbin
  node benchmark/scripts/make-variant.js --model benchmark/build/synthetic-d$D.puml --variant manual    --out benchmark/build/syn-d$D-manual
  # build + đo từng cặp, role = Level$D (role sâu nhất, chỉ có quyền qua kế thừa)
done
```

Model tổng hợp đặt toàn bộ permission ở `Level0`, role `Level{D}` chỉ nhận quyền
qua D bước kế thừa — ép guard trả giá hierarchy. Biểu đồ **p99 theo D** của 3
biến thể là kết quả trung tâm: casbin tăng theo D, manual phẳng, generated ở
giữa → định lượng lợi ích của việc flatten tại generation-time.

Quét thêm: `--extra-perms K` (phình PA table), `--aggregates M` (số endpoint).

### Bước 7 — Chỉ số quy trình phát triển (không cần chạy app)

```bash
npx cloc examples/course-management.puml                      # LOC đầu vào
npx cloc benchmark/build/app-generated/src                    # LOC sinh ra → hệ số khuếch đại
npx eslint benchmark/build/app-generated/src --no-eslintrc --env node \
  --parser-options ecmaVersion:2021                           # sạch lint?
npx tsc -p benchmark/build/app-generated --noEmit             # compile sạch?
```

## Kiểm soát tính hợp lệ (ghi vào luận văn)

- Cùng máy, cùng Node 20, container ghim `cpus: 2, mem: 1g` cho mọi biến thể.
- Warm-up trước khi đo (JIT); ≥ 10 lần lặp, báo cáo median + khoảng tứ phân vị.
- Load generator và server không tranh CPU: chạy autocannon từ máy khác hoặc
  ghim CPU tách biệt (taskset) nếu đo trên một máy.
- Handler là stub (không DB) — đo được *chênh lệch giữa các biến thể RBAC* chứ
  không phải hiệu năng tuyệt đối của hệ thật; đây là chủ đích thiết kế.
- Các biến thể chỉ khác đúng một file guard (hoặc decorator với `off`) — mọi
  thứ khác giữ nguyên.
