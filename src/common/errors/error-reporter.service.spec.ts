import { ErrorReporter, fingerprint } from './error-reporter.service.js';

function make(alertEmails = 'ops@flowhub.test') {
  const mail = { send: vi.fn().mockResolvedValue(undefined) };
  const config = {
    get: (key: string, fallback?: string) =>
      ({ ALERT_EMAILS: alertEmails, NODE_ENV: 'production' })[key] ?? fallback,
  };
  return { reporter: new ErrorReporter(config as never, mail as never), mail };
}

describe('ErrorReporter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emails each recipient with request context', async () => {
    const { reporter, mail } = make('a@x.test, b@x.test');
    await reporter.report(new TypeError('boom'), {
      source: 'http',
      method: 'GET',
      path: '/api/x',
      userId: 'u1',
    });
    expect(mail.send).toHaveBeenCalledTimes(2);
    expect(mail.send).toHaveBeenCalledWith(
      'a@x.test',
      'errorAlert',
      expect.objectContaining({
        name: 'TypeError',
        message: 'boom',
        where: 'GET /api/x',
        userId: 'u1',
        repeats: 0,
      }),
    );
  });

  it('sends the same error once per 10 minutes, then reports how many were suppressed', async () => {
    const { reporter, mail } = make();
    const fire = () => {
      const e = new Error('Project 64b000000000000000000001 failed');
      e.stack = 'Error: x\n    at ProjectsService.get (projects.service.ts:10)';
      return reporter.report(e, { source: 'http' });
    };
    await fire();
    await fire();
    await fire();
    expect(mail.send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await fire();
    expect(mail.send).toHaveBeenCalledTimes(2);
    expect(mail.send.mock.calls[1][2]).toMatchObject({ repeats: 2 });
  });

  it('caps total alerts at 20 per hour', async () => {
    const { reporter, mail } = make();
    for (let i = 0; i < 30; i++) {
      const e = new Error(`distinct failure`);
      e.stack = `Error\n    at place${'x'.repeat(i)} (file.ts:1)`;
      await reporter.report(e, { source: 'http' });
    }
    expect(mail.send).toHaveBeenCalledTimes(20);
  });

  it('only logs when no recipients are configured', async () => {
    const { reporter, mail } = make('');
    expect(reporter.enabled).toBe(false);
    await reporter.report(new Error('quiet'), { source: 'process' });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('never throws, even if sending fails', async () => {
    const { reporter, mail } = make();
    mail.send.mockRejectedValue(new Error('SES down'));
    await expect(
      reporter.report(new Error('x'), { source: 'http' }),
    ).resolves.toBeUndefined();
  });

  it('accepts non-Error values', async () => {
    const { reporter, mail } = make();
    await reporter.report({ weird: true }, { source: 'process' });
    expect(mail.send.mock.calls[0][2]).toMatchObject({
      message: '{"weird":true}',
    });
  });

  it('fingerprints ignore ids and numbers in messages', () => {
    const a = new Error('User 64b000000000000000000001 not found');
    const b = new Error('User 64b0000000000000000000ff not found');
    a.stack = b.stack = 'Error\n    at same (f.ts:1)';
    expect(fingerprint(a)).toBe(fingerprint(b));
  });
});
