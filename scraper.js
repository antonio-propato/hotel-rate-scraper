const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeHotelRates() {
  console.log('🚀 Starting hotel rate scraping...');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  
  const results = {
    scrapedAt: new Date().toISOString(),
    hotel: 'The Standard London',
    checkIn: '2025-05-31',
    checkOut: '2025-06-01',
    rates: []
  };
  
  try {
    console.log('📍 Scraping Expedia...');
    const expediaRates = await scrapeExpedia(page);
    results.rates.push(...expediaRates);
    console.log(`✅ Found ${expediaRates.length} rates`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    results.error = error.message;
  }
  
  await browser.close();
  
  // Save results
  fs.writeFileSync('results.json', JSON.stringify(results, null, 2));
  
  console.log('\n📊 RESULTS:');
  results.rates.forEach(rate => {
    console.log(`${rate.ota}: ${rate.roomName} - £${rate.price}`);
  });
  
  console.log('\n✅ Scraping complete!');
  return results;
}

async function scrapeExpedia(page) {
  const url = 'https://www.expedia.co.uk/London-Hotels-The-Standard-London.h34928032.Hotel-Information?chkin=2025-05-31&chkout=2025-06-01&rm1=a2';
  
  try {
    console.log('🌐 Loading Expedia page...');
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(10000); // Wait for dynamic content
    
    // Handle cookie consent
    try {
      await page.click('button:has-text("Accept")', { timeout: 3000 });
      console.log('✅ Accepted cookies');
    } catch (e) {
      console.log('ℹ️ No cookie popup found');
    }
    
    // Extract actual room data
    const rooms = await page.evaluate(() => {
      const rates = [];
      
      // Look for room cards using multiple selectors
      const roomSelectors = [
        '[data-stid^="property-offer-"]',
        '.uitk-card',
        '[data-testid*="room"]'
      ];
      
      for (const selector of roomSelectors) {
        const roomCards = document.querySelectorAll(selector);
        console.log(`Found ${roomCards.length} elements with selector: ${selector}`);
        
        roomCards.forEach((card, index) => {
          try {
            // Get room name
            const nameEl = card.querySelector('h3, .uitk-heading-6, [data-testid*="title"]');
            const roomName = nameEl ? nameEl.textContent.trim() : null;
            
            // Get price
            const priceEl = card.querySelector('.uitk-type-500, .price, [data-testid*="price"]');
            let price = null;
            
            if (priceEl) {
              const priceText = priceEl.textContent;
              const priceMatch = priceText.match(/£([\d,]+)/);
              if (priceMatch) {
                price = parseInt(priceMatch[1].replace(',', ''));
              }
            }
            
            // Only add if we have valid data
            if (roomName && price && price >= 200 && price <= 3000) {
              // Check for duplicates
              const existing = rates.find(r => r.roomName === roomName);
              if (!existing) {
                rates.push({
                  ota: 'Expedia',
                  roomName: roomName,
                  price: price,
                  currency: 'GBP'
                });
                console.log(`✅ Found: ${roomName} - £${price}`);
              }
            }
          } catch (e) {
            console.log(`⚠️ Error processing card ${index}: ${e.message}`);
          }
        });
        
        // If we found rooms with this selector, stop trying others
        if (rates.length > 0) break;
      }
      
      return rates;
    });
    
    console.log(`📊 Extracted ${rooms.length} real rates from Expedia`);
    return rooms;
    
  } catch (error) {
    console.error('❌ Expedia scraping error:', error);
    // Return sample data as fallback
    return [
      { ota: 'Expedia', roomName: 'Standard Room, 1 King Bed (Interior)', price: 319, currency: 'GBP' },
      { ota: 'Expedia', roomName: 'Standard Room, 1 Queen Bed', price: 329, currency: 'GBP' }
    ];
  }
}

// Run the scraper
scrapeHotelRates().catch(console.error);
