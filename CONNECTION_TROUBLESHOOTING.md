# MongoDB Atlas Connection Troubleshooting

## Common Issues and Solutions

### Issue 1: Connection String Format

Your `.env` file should have the connection string in this format:

```env
MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/rent_management?retryWrites=true&w=majority
```

**Important points:**
- ✅ Must include `/rent_management` before the `?` (this is your database name)
- ✅ Replace `username` and `password` with your actual credentials
- ✅ Replace `cluster0.xxxxx.mongodb.net` with your actual cluster address

### Issue 2: Password with Special Characters

If your password contains special characters, you need to URL encode them:

| Character | Encoded |
|-----------|---------|
| `@` | `%40` |
| `#` | `%23` |
| `$` | `%24` |
| `%` | `%25` |
| `&` | `%26` |
| `+` | `%2B` |
| `=` | `%3D` |
| `/` | `%2F` |
| `?` | `%3F` |

**Example:**
If your password is `MyP@ss#123`, the connection string should be:
```
mongodb+srv://username:MyP%40ss%23123@cluster0.xxxxx.mongodb.net/rent_management?retryWrites=true&w=majority
```

### Issue 3: Network Access Not Configured

1. Go to MongoDB Atlas → **Network Access**
2. Click **"Add IP Address"**
3. For development, click **"Allow Access from Anywhere"** (0.0.0.0/0)
4. Click **"Confirm"**
5. Wait 1-2 minutes for changes to propagate

### Issue 4: Database User Not Created

1. Go to MongoDB Atlas → **Database Access**
2. Click **"Add New Database User"**
3. Choose **"Password"** authentication
4. Enter username and password
5. Set privileges to **"Read and write to any database"**
6. Click **"Add User"**

### Issue 5: Wrong Connection String Source

Make sure you're getting the connection string from:
- **Database** → **Connect** → **"Connect your application"**
- NOT from "Connect with MongoDB Compass" or "Connect with VS Code"

## Test Your Connection

Run this command to test your connection:

```powershell
npm run test-connection
```

This will:
- ✅ Verify your `.env` file is loaded
- ✅ Test the connection
- ✅ Show available databases
- ✅ Provide specific error messages if connection fails

## Step-by-Step Verification

1. **Check your `.env` file exists** in the `backend` folder
2. **Verify the format:**
   ```
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/rent_management?retryWrites=true&w=majority
   ```
3. **Test the connection:**
   ```powershell
   npm run test-connection
   ```
4. **If it works, seed the database:**
   ```powershell
   npm run seed
   ```

## Still Having Issues?

Share the output of `npm run test-connection` and I can help you debug further!

