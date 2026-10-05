import { renderMail } from './mail.templates.js';

describe('renderMail', () => {
  it('renders subject and body with a raw link', () => {
    const { subject, html } = renderMail('invitation', {
      inviterName: 'Ada',
      organizationName: 'Acme & Co',
      role: 'admin',
      url: 'https://app.test/invite/abc?x=1',
    });
    expect(subject).toBe('Ada invited you to Acme & Co on FlowHub');
    expect(html).toContain('href="https://app.test/invite/abc?x=1"');
    // Body text is still HTML-escaped.
    expect(html).toContain('Acme &amp; Co');
  });

  it('escapes user-provided content', () => {
    const { html } = renderMail('notification', {
      title: '<script>x</script>',
      body: 'hi',
    });
    expect(html).not.toContain('<script>x</script>');
  });
});
