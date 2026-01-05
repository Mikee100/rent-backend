# MongoDB Atlas Setup Guide

## Step-by-Step Instructions

### 1. Create MongoDB Atlas Account
1. Go to: https://www.mongodb.com/cloud/atlas/register
2. Sign up with your email (free account)

### 2. Create a Free Cluster
1. After logging in, click **"Build a Database"**
2. Choose **FREE (M0) Shared** tier
3. Select a cloud provider (AWS, Google Cloud, or Azure)
4. Choose a region closest to you
5. Click **"Create"** (takes 1-3 minutes)

### 3. Create Database User
1. Go to **"Database Access"** in the left sidebar
2. Click **"Add New Database User"**
3. Choose **"Password"** authentication
4. Enter a username (e.g., `rentadmin`)
5. Click **"Autogenerate Secure Password"** or create your own
6. **IMPORTANT**: Copy and save the password!
7. Set privileges to **"Read and write to any database"**
8. Click **"Add User"**

### 4. Configure Network Access
1. Go to **"Network Access"** in the left sidebar
2. Click **"Add IP Address"**
3. For development, click **"Allow Access from Anywhere"** (0.0.0.0/0)
   - Or add your specific IP address for better security
4. Click **"Confirm"**

### 5. Get Your Connection String
1. Go back to **"Database"** (Clusters)
2. Click **"Connect"** button on your cluster
3. Choose **"Connect your application"**
4. Select **"Node.js"** and version **"5.5 or later"**
5. Copy the connection string (looks like):
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

### 6. Update Your .env File
Replace the connection string with your actual credentials:

1. Replace `<username>` with your database username
2. Replace `<password>` with your database password (URL encode special characters if needed)
3. Add `/rent_management` before the `?` to specify the database name

**Example:**
```
PORT=7000
MONGODB_URI=mongodb+srv://rentadmin:MyPassword123@cluster0.abc123.mongodb.net/rent_management?retryWrites=true&w=majority
NODE_ENV=development
```

### 7. Test the Connection
Run the seed script to test:
```powershell
npm run seed
```

If successful, you'll see:
```
Connected to MongoDB
Cleared existing apartments
Seeded 4 apartments successfully
```

## Troubleshooting

### Connection Timeout
- Make sure your IP address is whitelisted in Network Access
- Check that the password doesn't have special characters that need URL encoding

### Authentication Failed
- Double-check username and password
- Make sure the database user has read/write permissions

### URL Encoding Special Characters
If your password has special characters, encode them:
- `@` → `%40`
- `#` → `%23`
- `$` → `%24`
- `%` → `%25`
- `&` → `%26`
- `+` → `%2B`
- `=` → `%3D`

## Security Note
For production, use environment variables and never commit your `.env` file to version control!

