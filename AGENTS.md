# AGENTS.md

Guidance for AI agents working in the SpendSnap backend (NestJS + TypeORM + Supabase).

## Rules

### 1. Every new endpoint MUST update Swagger

Swagger is the source of truth for the API contract. Any time you add, change
remove a route, the OpenAPI docs must stay accurate. This is not optional.

When you add a controller method:

1. **Decorate the route** with `@nestjs/swagger`:
   - `@ApiOperation({ summary, description })` — what the endpoint does
   - `@ApiResponse({ status, description })` — one per realistic outcome
     (success + each error: 400 / 401 / 403 / 404 / 409 …)
   - `@ApiBearerAuth()` on any route behind `SupabaseAuthGuard`
   - `@ApiParam` / `@ApiQuery` for path and query params
2. **Decorate the DTO** — every field gets `@ApiProperty` (or `@ApiPropertyOptional`)
   with a `description`, alongside its `class-validator` decorators.
3. **Tag the controller** with `@ApiTags('<tag>')`.
4. **Register a new tag** in `src/main.ts` via `.addTag('<tag>', '<desc>')` if the
   controller introduces a tag that isn't there yet.
5. **Verify**: run `npm run build`, start the app, and confirm the route renders at
   `http://localhost:3000/docs`.

Example:

```ts
@ApiTags('receipts')
@ApiBearerAuth()
@UseGuards(SupabaseAuth
@Controller('receipts')
export class ReceiptsController {
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a receipt from an uploaded image' })
  @ApiResponse({ status: 201, description: 'Receipt created' })
  @ApiResponse({ status: 401, description: 'Missing or invalid Supabase token' })
  create(@CurrentUser() user: User, @Body() dto: CreateReceiptDto) { ... }
}
```

## Conventions

- **Global prefix** is `api/v1` (see `src/main.ts`). Swagger UI lives at `/docs`.
- **Swagger is non-production only** — gated on `NODE_ENV !== 'production'`.
- **Auth**: Supabase Auth owns login/SSO. Protect routes with `SupabaseAuthGuard`;
  get the user via the `@CurrentUser()` decorator. Do not build custom credential
  logic. (See `memory` note "auth-is-all-supabase".)
- **Validation**: a global `ValidationPipe` runs with `whitelist` +
  `forbidNonWi:
  :
  :qq;::
  ihitelisted` + `transform`. Every request body needs a DTO.
- **DB**: TypeORM with `synchronize` ON in dev, OFF in prod — write a migration for
  prod schema changes.

## Checklist before finishing any endpoint work

- [ ] Swagger decorators on route + DTO
- [ ] Tag registered in `main.ts` if new
- [ ] `npm run build` passes
- [ ] Route renders correctly in `/docs`
