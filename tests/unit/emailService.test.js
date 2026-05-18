const sendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail }))
}));

const sgMail = {
  setApiKey: jest.fn(),
  send: jest.fn()
};
jest.mock('@sendgrid/mail', () => sgMail);

const EmailService = require('../../email/emailService');

describe('EmailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendMail.mockResolvedValue({ messageId: 'msg_1' });
    sgMail.send.mockResolvedValue([{ statusCode: 202 }]);
  });

  it('sends nodemailer, templated, bulk, and helper emails', async () => {
    const service = new EmailService('nodemailer', {
      fromEmail: 'noreply@example.com',
      appUrl: 'https://app.example.com'
    });

    await expect(service.sendEmail('a@example.com', 'Hello', '<p>Hi</p>')).resolves.toEqual({
      messageId: 'msg_1'
    });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'noreply@example.com',
      to: 'a@example.com',
      subject: 'Hello'
    }));

    service.registerTemplate('welcome', 'Welcome {{name}}', '<h1>Hello {{name}}</h1>');
    await service.sendTemplateEmail('a@example.com', 'welcome', { name: 'Alice' });
    expect(sendMail).toHaveBeenLastCalledWith(expect.objectContaining({
      html: '<h1>Hello Alice</h1>'
    }));

    await expect(service.sendBulkEmails(['a@example.com', 'b@example.com'], 'Bulk', '<p>Hi</p>')).resolves.toHaveLength(2);
    await service.sendWelcomeEmail('a@example.com', 'Alice');
    await service.sendPasswordResetEmail('a@example.com', 'reset-token');
    await service.sendVerificationEmail('a@example.com', 'verify-token');
    await service.sendNotification('a@example.com', 'Notice', 'Message');
    await service.sendTestEmail();

    expect(sendMail).toHaveBeenCalled();
  });

  it('sends via SendGrid and validates email addresses', async () => {
    const service = new EmailService('sendgrid', {
      apiKey: 'sg-key',
      fromEmail: 'noreply@example.com'
    });

    await expect(service.sendEmail('a@example.com', 'Hello', '<p>Hi</p>')).resolves.toEqual([{ statusCode: 202 }]);
    expect(sgMail.setApiKey).toHaveBeenCalledWith('sg-key');
    expect(sgMail.send).toHaveBeenCalledWith({
      to: 'a@example.com',
      from: 'noreply@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>'
    });
    expect(EmailService.isValidEmail('valid@example.com')).toBe(true);
    expect(EmailService.isValidEmail('invalid')).toBe(false);
  });

  it('rejects missing templates and past schedules', async () => {
    const service = new EmailService('nodemailer', {});

    await expect(service.sendTemplateEmail('a@example.com', 'missing')).rejects.toThrow('Template not found');
    await expect(service.scheduleEmail('a@example.com', 'Past', '<p>x</p>', new Date(Date.now() - 1000))).rejects.toThrow(
      'Schedule time must be in the future'
    );
  });
});
