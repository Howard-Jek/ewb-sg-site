-- Tables behind the website's forms (previously stored by Wix Forms) and the
-- members roster.
--
-- Access model: rows are written only by the Vercel function at /api/forms,
-- which uses the project's secret key (the service_role, which bypasses RLS).
-- RLS is on with no policies and privileges are revoked from the public API
-- roles, so the publishable/anon key can neither read nor write any of this.
-- Staff read and manage rows in the Supabase dashboard.
--
-- Column limits mirror lib/forms.ts, which validates first and gives friendlier
-- errors; these checks are the backstop.

create table public.membership_applications (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text check (char_length(last_name) <= 100),
  email text not null check (char_length(email) <= 254 and email = lower(email)),
  phone text check (char_length(phone) <= 40),
  highest_qualification text check (
    highest_qualification in (
      'Diploma', 'Bachelor''s Degree', 'Master''s Degree', 'PhD', 'Professional Certification', 'Others'
    )
  ),
  qualification_title text check (char_length(qualification_title) <= 200),
  company text check (char_length(company) <= 200),
  position text check (char_length(position) <= 200),
  contribution text check (char_length(contribution) <= 5000),
  source_page text check (char_length(source_page) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected'))
);
comment on table public.membership_applications is
  'Membership sign-ups from the "Sign Up" form (home page pop-up and /general-6/ Volunteer page).';

create table public.newsletter_subscribers (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  email text not null unique check (char_length(email) <= 254 and email = lower(email)),
  first_name text check (char_length(first_name) <= 100),
  last_name text check (char_length(last_name) <= 100),
  source_page text check (char_length(source_page) <= 300),
  unsubscribed_at timestamptz
);
comment on table public.newsletter_subscribers is
  'Home page "Subscribe" form. One row per email; repeat sign-ups are ignored.';

create table public.donations (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text not null check (char_length(last_name) between 1 and 100),
  email text not null check (char_length(email) <= 254 and email = lower(email)),
  on_behalf_of text not null check (on_behalf_of in ('Myself', 'An organization', 'Someone else')),
  honoree_name text check (char_length(honoree_name) <= 200),
  amount_sgd numeric(12, 2) not null check (amount_sgd > 0 and amount_sgd <= 1000000),
  terms_accepted boolean not null check (terms_accepted),
  source_page text check (char_length(source_page) <= 300),
  verified_at timestamptz
);
comment on table public.donations is
  'Self-reported on /donate/ after paying by PayNow or bank transfer; not proof of payment. '
  'Set verified_at once the transfer is matched against the bank statement.';

create table public.contact_messages (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  first_name text check (char_length(first_name) <= 100),
  last_name text check (char_length(last_name) <= 100),
  email text not null check (char_length(email) <= 254 and email = lower(email)),
  subject text check (char_length(subject) <= 200),
  message text check (char_length(message) <= 5000),
  source_page text check (char_length(source_page) <= 300),
  handled_at timestamptz
);
comment on table public.contact_messages is 'The "Have a question?" form on /stay-connected/ (Contact Us).';

create table public.members (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  display_name text not null check (char_length(display_name) between 1 and 200),
  email text unique check (char_length(email) <= 254 and email = lower(email)),
  source text not null default 'manual' check (char_length(source) <= 50),
  notes text
);
comment on table public.members is
  'EWB (SG) members. Seeded from the public roster of the Wix "EWB (Singapore) Members Forum" group, '
  'which exposed display names only.';

do $$
declare
  t text;
begin
  foreach t in array array[
    'membership_applications', 'newsletter_subscribers', 'donations', 'contact_messages', 'members'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('revoke all on sequence public.%I from anon, authenticated', t || '_id_seq');
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('grant usage, select on sequence public.%I to service_role', t || '_id_seq');
  end loop;
end
$$;
