/**
 * Mail over plain SMTP (nodemailer), for the confirmation of addresses and
 * the links that set a new password. SMTP_URL names the server
 * (smtps://user:password@host:465, or smtp://...:587 for STARTTLS) and
 * MAIL_FROM the sender; without SMTP_URL the installation sends no mail, and
 * the flows that need it fall back as docs/install.md says.
 *
 * Messages are plain text. The flows take a Mailer, so that tests can
 * collect the messages instead of sending them.
 */
import { env } from '$env/dynamic/private';
import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** The installation's name, for mail and citations (SITE_NAME, default Varians). */
export function siteName(): string {
  return env.SITE_NAME?.trim() || 'Varians';
}

/**
 * The name and public origin used in links: ORIGIN, or the request's origin
 * when ORIGIN is not set (only for links shown to an administrator, since
 * mail is not sent without ORIGIN).
 */
export function siteOf(requestOrigin: string): { name: string; origin: string } {
  return { name: siteName(), origin: (env.ORIGIN?.trim() || requestOrigin).replace(/\/+$/u, '') };
}

/**
 * Whether this installation sends mail: SMTP_URL and ORIGIN are both set.
 * The links in mail are made from ORIGIN only, never from the request's Host
 * header, which a visitor chooses: otherwise a request for a new password
 * could send the owner of an account a link to another site.
 */
export function mailConfigured(): boolean {
  return Boolean(env.SMTP_URL?.trim() && env.ORIGIN?.trim());
}

/** The sender: MAIL_FROM, or the site's name at noreply@ the host of ORIGIN. Pure. */
export function senderOf(mailFrom: string | undefined, origin: string | undefined, name: string): string {
  if (mailFrom?.trim()) return mailFrom.trim();
  let host = 'localhost';
  try {
    if (origin) host = new URL(origin).hostname;
  } catch {
    // An unparseable ORIGIN leaves the default.
  }
  return `${name.replace(/["<>\r\n]/gu, '')} <noreply@${host}>`;
}

/** No header may carry a line break: a subject or address with one could add headers of its own. */
export function assertHeaderSafe(value: string): string {
  if (/[\r\n]/u.test(value)) throw new Error('A mail header may not contain a line break.');
  return value;
}

let smtp: Mailer | null = null;

/** The mailer of this installation, or null when SMTP_URL is not set. */
export function mailer(): Mailer | null {
  const url = env.SMTP_URL?.trim();
  if (!url || !mailConfigured()) return null;
  if (!smtp) {
    const transport = nodemailer.createTransport(url);
    const from = senderOf(env.MAIL_FROM, env.ORIGIN, siteName());
    smtp = {
      async send(message) {
        await transport.sendMail({
          from,
          to: assertHeaderSafe(message.to),
          subject: assertHeaderSafe(message.subject),
          text: message.text,
        });
      },
    };
  }
  return smtp;
}
