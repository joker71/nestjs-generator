/** Sinh bởi gen-app-bootstrap.js — đừng sửa tay */
import { Module } from '@nestjs/common';
import { PerfContextModule } from './perf-context/perf-context.module';

@Module({
  imports: [PerfContextModule],
})
export class AppModule {}
