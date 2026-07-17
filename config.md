# Xem metamodel trung gian (JSON) không sinh file
npx ts-node src/cli.ts inspect -i examples/course-management.puml --transform

# Xem trước file sẽ sinh, không ghi
npm run generate -- -i examples/course-management.puml --dry-run

# Build ra dist/ rồi chạy như CLI
npm run build
node dist/cli.js generate -i examples/course-management.puml -o generated

# Smoke-test OCL parser (sau khi npm install)
npm run test:ocl