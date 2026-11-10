/** What the account actions return; each form shows only its own result. */
export type AccountFormName =
  | 'name'
  | 'orcid'
  | 'token'
  | 'revoke'
  | 'password'
  | 'preferences'
  | 'offer';

export interface AccountActionResult {
  form: AccountFormName;
  ok?: boolean;
  errors?: Record<string, string[] | undefined>;
  values?: Record<string, string | undefined>;
  /** For the ORCID form: whose work was claimed, and whether the iD was removed. */
  claimed?: string | null;
  cleared?: boolean;
  /** A token just made, shown once. */
  token?: string;
}
