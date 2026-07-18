/** Sinh bởi gen-app-bootstrap.js — đừng sửa tay */
import { Module } from '@nestjs/common';
import { EnrollmentContextModule } from './enrollment-context/enrollment-context.module';
import { SClassContextModule } from './s-class-context/s-class-context.module';

@Module({
  imports: [EnrollmentContextModule, SClassContextModule],
})
export class AppModule {}
