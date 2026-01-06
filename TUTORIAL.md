# SyncYTM Setup Tutorial

## 1. Installation
Run the following commands in your terminal:
```bash
npm install
```

## 2. Supabase Setup
1. Go to [Supabase](https://supabase.com/) and create a new project.
2. Go to the **SQL Editor** in your Supabase dashboard.
3. Copy the contents of `supabase.sql` from this project and paste it into the editor.
4. Click **Run**.
5. Go to **Project Settings** -> **API**.
6. Copy the **Project URL** and **anon public key**.

## 3. Environment Variables
1. Create a file named `.env` in the root of this project.
2. Copy the contents of `.env.example` into `.env`.
3. Replace the placeholder values with your Supabase keys.
4. **YouTube API**:
    - Go to [Google Cloud Console](https://console.cloud.google.com/).
    - Create a project and enable the **YouTube Data API v3**.
    - Create an API Key.
    - Add `VITE_YOUTUBE_API_KEY=your_api_key` to `.env`.

## 4. Run the Project
```bash
npm run dev
```
