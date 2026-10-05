import Handlebars from 'handlebars';

/**
 * Transactional email templates. Kept in code (not .hbs files) so `nest build`
 * ships them without asset-copy config. Every body is wrapped in `layout`.
 */
const layout = Handlebars.compile(`<!doctype html>
<html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#0f172a">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0">
<tr><td style="padding:32px">
<p style="margin:0 0 24px;font-weight:600;font-size:18px;color:#4f46e5">FlowHub</p>
{{{body}}}
</td></tr></table>
<p style="font-size:12px;color:#94a3b8;margin-top:16px">You received this email because of activity on your FlowHub account.</p>
</td></tr></table></body></html>`);

// URLs are built server-side (never user input), so they are emitted raw:
// Handlebars would otherwise HTML-escape "=" in query strings.
const button = (label: string) =>
  `<p style="margin:28px 0"><a href="{{{url}}}" style="background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;font-size:14px">${label}</a></p>
<p style="font-size:12px;color:#64748b">Or paste this link into your browser:<br><span style="word-break:break-all">{{url}}</span></p>`;

const TEMPLATES = {
  verifyEmail: {
    subject: 'Confirm your email for FlowHub',
    body: `<h1 style="font-size:20px;margin:0 0 12px">Confirm your email</h1>
<p>Hi {{name}}, please confirm this is your email address. The link expires in 24 hours.</p>
${button('Confirm email')}`,
  },
  resetPassword: {
    subject: 'Reset your FlowHub password',
    body: `<h1 style="font-size:20px;margin:0 0 12px">Reset your password</h1>
<p>Hi {{name}}, someone asked to reset the password for this account. The link expires in 1 hour.
If it wasn't you, ignore this email; your password won't change.</p>
${button('Choose a new password')}`,
  },
  invitation: {
    subject: '{{inviterName}} invited you to {{organizationName}} on FlowHub',
    body: `<h1 style="font-size:20px;margin:0 0 12px">Join {{organizationName}}</h1>
<p>{{inviterName}} invited you to join <strong>{{organizationName}}</strong> on FlowHub as {{role}}.
The invitation expires in 7 days.</p>
${button('Accept invitation')}`,
  },
  notification: {
    subject: '{{title}}',
    body: `<h1 style="font-size:20px;margin:0 0 12px">{{title}}</h1>
<p>{{body}}</p>
{{#if url}}${button('Open FlowHub')}{{/if}}`,
  },
  errorAlert: {
    subject: '[FlowHub {{environment}}] {{name}}: {{message}}',
    body: `<h1 style="font-size:18px;margin:0 0 8px;color:#b91c1c">{{name}}: {{message}}</h1>
<p style="font-size:13px;color:#64748b;margin:0 0 16px">{{time}} · {{environment}} · source: {{source}}{{#if repeats}} · {{repeats}} more since the last alert{{/if}}</p>
<table style="font-size:13px;border-collapse:collapse;margin-bottom:16px">
{{#if where}}<tr><td style="padding:2px 12px 2px 0;color:#64748b">Request</td><td><code>{{where}}</code></td></tr>{{/if}}
{{#if userId}}<tr><td style="padding:2px 12px 2px 0;color:#64748b">User</td><td><code>{{userId}}</code></td></tr>{{/if}}
{{#if organizationId}}<tr><td style="padding:2px 12px 2px 0;color:#64748b">Organization</td><td><code>{{organizationId}}</code></td></tr>{{/if}}
{{#if detail}}<tr><td style="padding:2px 12px 2px 0;color:#64748b">Detail</td><td>{{detail}}</td></tr>{{/if}}
</table>
<pre style="font-size:12px;line-height:1.5;background:#f1f5f9;padding:12px;border-radius:6px;white-space:pre-wrap;word-break:break-all">{{stack}}</pre>`,
  },
} satisfies Record<string, { subject: string; body: string }>;

export type MailTemplate = keyof typeof TEMPLATES;

const compiled = Object.fromEntries(
  Object.entries(TEMPLATES).map(([key, t]) => [
    key,
    {
      subject: Handlebars.compile(t.subject, { noEscape: true }),
      body: Handlebars.compile(t.body),
    },
  ]),
) as Record<
  MailTemplate,
  { subject: HandlebarsTemplateDelegate; body: HandlebarsTemplateDelegate }
>;

export function renderMail(
  template: MailTemplate,
  data: Record<string, unknown>,
): { subject: string; html: string } {
  const t = compiled[template];
  return { subject: t.subject(data), html: layout({ body: t.body(data) }) };
}
