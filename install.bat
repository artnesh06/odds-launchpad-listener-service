@echo off
echo ========================================
echo NFT Listener Service - Installation
echo ========================================
echo.

echo [1/4] Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)
echo.

echo [2/4] Checking environment file...
if not exist .env (
    echo Creating .env from template...
    copy .env.example .env
    echo.
    echo IMPORTANT: Please edit .env file with your configuration!
    echo - DATABASE_URL
    echo - RPC URLs for your chains
    echo.
) else (
    echo .env file already exists
)
echo.

echo [3/4] Generating Prisma Client...
call npm run db:generate
if %errorlevel% neq 0 (
    echo ERROR: Failed to generate Prisma Client
    echo Make sure DATABASE_URL is set correctly in .env
    pause
    exit /b 1
)
echo.

echo [4/4] Installation complete!
echo.
echo ========================================
echo Next Steps:
echo ========================================
echo 1. Edit .env file with your configuration
echo 2. Run: npm run dev (for development)
echo 3. Or run: npm start (for production)
echo.
echo For deployment instructions, see SETUP.md
echo ========================================
echo.
pause
