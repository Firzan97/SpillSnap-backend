import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  // rawBody: true keeps the unparsed body so the Stripe webhook can verify its
  // signature against the exact bytes Stripe signed.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // CORS — allow Expo dev client and web.
  // FRONTEND_URL may be a comma-separated list (apex, www, app subdomain, …).
  const frontendOrigins = (process.env.FRONTEND_URL ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: [
      'http://localhost:8081',
      'http://localhost:19006',
      'http://localhost:3001', // web (Nuxt) dev origin
      ...frontendOrigins,
    ],
    credentials: true,
  });

  // Global validation pipe — strip unknown fields, transform types
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Swagger — only in non-production
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('SpendSnap API')
      .setDescription(
        'Receipt scanning, LHDN tax tagging, and spend analytics for Malaysia',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addTag(
        'auth',
        'Authentication — verify Supabase token, sync user (Supabase Auth owns login/SSO)',
      )
      .addTag('dashboard', 'Home dashboard endpoint')
      .addTag(
        'receipts',
        'Capture (OCR extract), save, list, edit, and delete receipts',
      )
      .addTag(
        'leaderboard',
        'Receipt-upload leaderboard — podium, rankings, and current-user standing',
      )
      .addTag(
        'notifications',
        'In-app notification feed — list, unread count, mark read',
      )
      .addTag(
        'settings',
        'Server-driven settings screens (index, account & security, help) + categories, tags, notification prefs',
      )
      .addTag('export', 'CSV export for LHDN e-Filing — summary, generate, re-download')
      .addTag('pricing', 'Public plan catalog (Free + Pro)')
      .addTag(
        'subscription',
        'Current entitlement, Stripe checkout + customer portal',
      )
      .addTag(
        'public',
        'Unauthenticated landing-page data — marketing stats and approved testimonials (server-cached hourly)',
      )
      .addTag(
        'webhooks',
        'External provider webhooks (Stripe). Signature-verified; not called by our apps',
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    console.log(
      `📚 Swagger: http://localhost:${process.env.PORT ?? 3000}/docs`,
    );
  }

  const port = process.env.PORT ?? 3000;
  // Bind to all interfaces (not just loopback) so physical devices on the LAN
  // can reach the API at the machine's IP, e.g. http://192.168.x.x:PORT.
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 SpendSnap API running on http://localhost:${port}/api/v1`);
}

bootstrap();
