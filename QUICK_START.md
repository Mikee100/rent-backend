# Quick Start - Fix MongoDB Connection

## The Problem
MongoDB is not running or not accessible at `localhost:27017`

## Solution Options

### ✅ EASIEST: Use MongoDB Atlas (Free Cloud Database)

1. **Sign up for MongoDB Atlas** (free tier):
   - Go to: https://www.mongodb.com/cloud/atlas/register
   - Create a free account

2. **Create a Cluster**:
   - Click "Build a Database"
   - Choose FREE tier (M0)
   - Select a cloud provider and region
   - Click "Create"

3. **Set up Database Access**:
   - Go to "Database Access" → "Add New Database User"
   - Create username and password (save these!)
   - Set privileges to "Read and write to any database"

4. **Set up Network Access**:
   - Go to "Network Access" → "Add IP Address"
   - Click "Allow Access from Anywhere" (for development)
   - Or add your current IP address

5. **Get Connection String**:
   - Go to "Database" → Click "Connect" on your cluster
   - Choose "Connect your application"
   - Copy the connection string
   - Replace `<password>` with your database user password
   - Replace `<dbname>` with `rent_management`

6. **Update your `.env` file** in the backend folder:
   ```
   PORT=7000
   MONGODB_URI=mongodb+srv://yourusername:yourpassword@cluster0.xxxxx.mongodb.net/rent_management?retryWrites=true&w=majority
   NODE_ENV=development
   ```

7. **Run the seed script**:
   ```powershell
   npm run seed
   ```

---

### Alternative: Install MongoDB Locally

1. **Download MongoDB**:
   - https://www.mongodb.com/try/download/community
   - Choose Windows installer (.msi)

2. **Install MongoDB**:
   - Run the installer
   - Choose "Complete" installation
   - ✅ Check "Install MongoDB as a Service"
   - ✅ Check "Run service as Network Service user"
   - ✅ Check "Install MongoDB Compass" (GUI tool)

3. **Start MongoDB Service**:
   ```powershell
   # Check if service exists
   Get-Service -Name MongoDB
   
   # Start the service
   Start-Service -Name MongoDB
   ```

4. **Verify it's running**:
   ```powershell
   mongosh
   # If this connects, MongoDB is working!
   ```

5. **Your `.env` file should have**:
   ```
   PORT=7000
   MONGODB_URI=mongodb://localhost:27017/rent_management
   NODE_ENV=development
   ```

6. **Run the seed script**:
   ```powershell
   npm run seed
   ```

---

## After MongoDB is Connected

Once you've set up MongoDB (either Atlas or local), run:

```powershell
# Seed the 4 apartments
npm run seed

# Start the backend server
npm run dev
```

The seed script will create:
- A101: 2BR, 1BA - $1200/month
- A102: 1BR, 1BA - $900/month  
- A201: 3BR, 2BA - $1500/month
- A202: 2BR, 1BA - $1100/month

