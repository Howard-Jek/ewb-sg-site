-- The only user records in the Wix export: the three people listed on
-- /group/ewb-singapore-members-forum/members/. Wix showed display names only.
insert into public.members (display_name, source, notes) values
  ('Nishanth S P', 'wix_members_forum', null),
  ('Angeline Tan', 'wix_members_forum', null),
  ('Angeline Test', 'wix_members_forum', 'Probably a test account on the Wix forum; delete if so.');
