import {
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { Public } from '../src/common/decorators/public.decorator.js';

@Public()
@Controller('boom')
class BoomController {
  @Get('crash')
  crash() {
    throw new TypeError("Cannot read properties of undefined (reading 'role')");
  }

  @Get('bad-request')
  badRequest() {
    throw new HttpException('nope', 400);
  }

  @Get('unavailable')
  unavailable() {
    throw new HttpException('down', 503);
  }

  @Get('explicit-500')
  explicit500() {
    throw new InternalServerErrorException('ledger out of sync');
  }
}

let app: INestApplication;
let mongo: MongoMemoryServer;
let outbox: { to: string; subject: string; html: string }[];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  Object.assign(process.env, {
    MONGODB_URI: mongo.getUri('flowhub-errors'),
    JWT_SECRET: 'e2e',
    MAIL_FROM: '',
    ALERT_EMAILS: 'ops@flowhub.test',
  });
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');
  const { MailService } = await import('../src/mail/mail.service.js');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [BoomController],
  }).compile();
  app = configureApp(moduleRef.createNestApplication());
  await app.init();
  outbox = app.get(MailService).outbox;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await mongo?.stop();
  process.env.ALERT_EMAILS = '';
});

const alerts = () => outbox.filter((m) => m.to === 'ops@flowhub.test');
const waitForAlerts = async (n: number) => {
  for (let i = 0; i < 40 && alerts().length < n; i++)
    await new Promise((r) => setTimeout(r, 25));
};

describe('error alerts', () => {
  it('emails unexpected errors and still answers with a plain 500', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/boom/crash?token=secret')
      .expect(500);
    expect(res.body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });

    await waitForAlerts(1);
    expect(alerts()).toHaveLength(1);
    const [alert] = alerts();
    expect(alert.subject).toContain(
      "TypeError: Cannot read properties of undefined (reading 'role')",
    );
    expect(alert.html).toContain('GET /api/boom/crash');
    expect(alert.html).not.toContain('secret'); // query strings can hold tokens
  });

  it('dedupes repeats of the same error', async () => {
    await request(app.getHttpServer()).get('/api/boom/crash').expect(500);
    await request(app.getHttpServer()).get('/api/boom/crash').expect(500);
    await new Promise((r) => setTimeout(r, 100));
    expect(alerts()).toHaveLength(1);
  });

  it('reports explicit 500s, but not deliberate 4xx/501/503 answers', async () => {
    await request(app.getHttpServer()).get('/api/boom/bad-request').expect(400);
    await request(app.getHttpServer()).get('/api/boom/unavailable').expect(503);
    await request(app.getHttpServer())
      .get('/api/boom/explicit-500')
      .expect(500);
    await waitForAlerts(2);
    expect(alerts()).toHaveLength(2);
    expect(alerts()[1].subject).toContain('ledger out of sync');
  });

  it('accepts browser crash reports', async () => {
    await request(app.getHttpServer())
      .post('/api/client-errors')
      .send({
        message: 'ChunkLoadError: Loading chunk 42 failed',
        url: 'https://flowhub.com/app',
        userAgent: 'Chrome',
      })
      .expect(204);
    await waitForAlerts(3);
    expect(alerts()[2].subject).toContain('ClientError: ChunkLoadError');
    await request(app.getHttpServer())
      .post('/api/client-errors')
      .send({})
      .expect(400);
  });

  it('still maps duplicate keys to 409 without alerting', async () => {
    const before = alerts().length;
    const body = {
      name: 'Dup',
      email: 'dup@x.test',
      password: 'password123',
      organizationName: 'Dup Co',
    };
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(body)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(body)
      .expect(409);
    expect(alerts().length).toBe(before);
  });
});
