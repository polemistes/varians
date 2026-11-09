/**
 * The messages Varians sends by mail: plain text, signed with the
 * installation's name and address. Imported as `mail` from
 * '$lib/strings/mail'. Plain English, no em dashes.
 *
 * The messages do not name the account's holder: whoever registers chooses
 * the name, and a message to an address that is not theirs must not carry
 * words of their choosing.
 */

interface Message {
  site: string;
  link: string;
  origin: string;
}

const signature = (site: string, origin: string) => `${site}\n${origin}\n`;

export const mail = {
  verify: {
    subject: (site: string) => `Confirm your address for ${site}`,
    text: ({ site, link, origin }: Message) =>
      `To confirm that this is the address of your account at ${site}, open this link:\n\n${link}\n\nThe link is valid for a day and can be used once. If you did not make an account at ${site}, disregard this message: the account cannot be used without the link.\n\n${signature(site, origin)}`,
  },
  reset: {
    subject: (site: string) => `A new password for ${site}`,
    text: ({ site, link, origin }: Message) =>
      `To set a new password for your account at ${site}, open this link:\n\n${link}\n\nThe link is valid for an hour and can be used once. If you did not ask for a new password, disregard this message: your password stays as it is.\n\n${signature(site, origin)}`,
  },
  resetByAdministrator: {
    subject: (site: string) => `A new password for ${site}`,
    text: ({ site, link, origin }: Message) =>
      `An administrator of ${site} has sent you this link to set a new password for your account:\n\n${link}\n\nThe link is valid for a day and can be used once. Until it is used, your password stays as it is.\n\n${signature(site, origin)}`,
  },
};
