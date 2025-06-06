name: Hotel Rate Scraper

on:
  schedule:
    # Run daily at 6 AM UTC (7 AM UK time)
    - cron: '0 6 * * *'
  workflow_dispatch: # Allows you to run manually

jobs:
  scrape-hotel-rates:
    runs-on: ubuntu-latest
    
    steps:
    - name: Checkout repository
      uses: actions/checkout@v4
      
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '18'
        
    - name: Install Playwright
      run: |
        npm install playwright
        npx playwright install chromium
        
    - name: Run hotel scraper
      run: node scraper.js
      
    - name: Upload results
      uses: actions/upload-artifact@v4
      with:
        name: hotel-rates-${{ github.run_number }}
        path: results.json
        retention-days: 30
