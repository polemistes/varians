export type Role = 'member' | 'editor' | 'administrator';

export type GreekFont = 'eb-garamond' | 'cardo';

export type User = {
    id: number;
    name: string;
    email: string;
    role: Role;
    greek_font: GreekFont;
    avatar?: string;
    email_verified_at: string | null;
    created_at: string;
    updated_at: string;
    [key: string]: unknown;
};

export type Auth = {
    user: User | null;
    /** Editions offered to her and not yet answered — see the profile page. */
    pendingOffers?: number;
};
