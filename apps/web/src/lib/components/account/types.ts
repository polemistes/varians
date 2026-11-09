/** What the account actions return; each form shows only its own result. */
export type AccountFormName = 'name' | 'password' | 'preferences' | 'offer';

export interface AccountActionResult {
  form: AccountFormName;
  ok?: boolean;
  errors?: Record<string, string[] | undefined>;
  values?: Record<string, string | undefined>;
}
