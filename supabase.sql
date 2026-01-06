-- Create a table for public profiles
create table profiles (
  id uuid references auth.users not null primary key,
  updated_at timestamp with time zone,
  username text unique,
  avatar_url text,
  constraint username_length check (char_length(username) >= 3)
);

alter table profiles enable row level security;

create policy "Public profiles are viewable by everyone." on profiles
  for select using (true);

create policy "Users can insert their own profile." on profiles
  for insert with check (auth.uid() = id);

create policy "Users can update own profile." on profiles
  for update using (auth.uid() = id);

-- Create a table for Rooms
create table rooms (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  host_id uuid references auth.users not null,
  name text not null,
  is_private boolean default false,
  password_hash text, -- simple storage for now, ideally clearer handling
  queue jsonb default '[]'::jsonb, -- persistent queue storage
  current_state jsonb default '{}'::jsonb -- store current playing song, time, etc if needed for persistent state
);

alter table rooms enable row level security;

create policy "Rooms are viewable by everyone." on rooms
  for select using (true);

create policy "Authenticated users can create rooms." on rooms
  for insert with check (auth.uid() = host_id);

create policy "Host can update their room." on rooms
  for update using (auth.uid() = host_id);

-- Enable Realtime
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;
alter publication supabase_realtime add table rooms;

-- Trigger to create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, avatar_url)
  values (new.id, new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
