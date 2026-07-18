/** Sinh bởi gen-app-bootstrap.js — đừng sửa tay */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { rolesHeaderMiddleware } from './auth-stub.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.use(rolesHeaderMiddleware);
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  console.log('listening on ' + (process.env.PORT ?? 3000));
}
bootstrap();
