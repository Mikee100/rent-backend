# MongoDB Setup Guide

## Option 1: MongoDB Atlas (Cloud - Recommended)

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)
2. Sign up for a free account
3. Create a new cluster (free tier available)
4. Click "Connect" → "Connect your application"
5. Copy the connection string (looks like: `mongodb+srv://username:password@cluster.mongodb.net/rent_management`)
6. Update your `.env` file:
   ```
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/rent_management
   ```

## Option 2: Local MongoDB Installation

### Install MongoDB on Windows:

1. Download MongoDB Community Server from: https://www.mongodb.com/try/download/community
2. Run the installer
3. Choose "Complete" installation
4. Install as a Windows Service (recommended)
5. MongoDB will start automatically

### Start MongoDB Service (if not running):

```powershell
# Check if MongoDB service exists
Get-Service -Name MongoDB

# Start MongoDB service
Start-Service -Name MongoDB

# Or if service name is different, try:
net start MongoDB
```

### Verify MongoDB is running:

```powershell
# Test connection
mongosh
# or
mongo
```

## Option 3: Use Docker (if you have Docker installed)

```powershell
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

Then use in `.env`:
```
MONGODB_URI=mongodb://localhost:27017/rent_management
```

## After Setup

Once MongoDB is configured, run:
```bash
npm run seed
```

This will create the 4 default apartments in your database.

