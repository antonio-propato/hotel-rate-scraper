const { chromium } = require('playwright');
const fs = require('fs');

async function scrapeHotelRates() {
  console.log('🚀 Starting hotel rate scraping...');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Set realistic headers
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const results = {
    scrapedAt: new Date().toISOString(),
    hotel: 'The Standard London',
    checkIn: '2025-05-31',
    checkOut: '2025-06-01',
    rates: []
  };
  
  try {
    // Scrape Expedia
    console.log('📍 Scraping Expedia...');
    const expediaRates = await scrapeExpedia(page);
    results.rates.push(...expediaRates);
    console.log(`✅ Expedia: Found ${expediaRates.length} rates`);
    
    // Wait between sites
    await page.waitForTimeout(5000);
    
    // Scrape Booking.com
    console.log('📍 Scraping Booking.com...');
    const bookingRates = await scrapeBooking(page);
    results.rates.push(...bookingRates);
    console.log(`✅ Booking.com: Found ${bookingRates.length} rates`);
    
  } catch (error) {
    console.error('❌ Scraping error:', error);
    results.error = error.message;
  }
  
  await browser.close();
  
  // Save results
  fs.writeFileSync('results.json', JSON.stringify(results, null, 2));
  
  // Display summary
  console.log('\n📊 SCRAPING SUMMARY');
  console.log('==================');
  console.log(`Total rates found: ${results.rates.length}`);
  
  if (results.rates.length > 0) {
    const prices = results.rates.map(r => r.price).sort((a, b) => a - b);
    console.log(`Price range: £${prices[0]} - £${prices[prices.length - 1]}`);
    
    // Show cheapest rooms
    console.log('\n🏆 CHEAPEST RATES:');
    const sortedRates = results.rates.sort((a, b) => a.price - b.price);
    sortedRates.slice(0, 5).forEach(rate => {
      console.log(`${rate.ota}: ${rate.roomName} - £${rate.price}`);
    });
  }
  
  console.log('\n✅ Scraping complete!');
  return results;
}

async function scrapeExpedia(page) {
  const url = 'https://www.expedia.co.uk/London-Hotels-The-Standard-London.h34928032.Hotel-Information?chkin=2025-05-31&chkout=2025-06-01&x_pwa=1&rm1=a2';
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(8000); // Wait for dynamic content
    
    // Handle cookie consent
    try {
      await page.click('button:has-text("Accept")', { timeout: 3000 });
    } catch (e) {}
    
    // Extract room data using simpler selectors
    const rooms = await page.evaluate(() => {
      const rates = [];
      
      // Look for room cards with different possible selectors
      const selectors = [
        '[data-stid^="property-offer-"]',
        '.uitk-card',
        '[data-testid*="room"]'
      ];
      
      for (const selector of selectors) {
        const cards = document.querySelectorAll(selector);
        
        cards.forEach((card, index) => {
          try {
            // Try multiple selectors for room name
            const nameSelectors = ['h3', '.uitk-heading-6', '[data-testid*="title"]'];
            let roomName = null;
            
            for (const nameSelector of nameSelectors) {
              const nameEl = card.querySelector(nameSelector);
              if (nameEl && nameEl.textContent.length > 5) {
                roomName = nameEl.textContent.trim();
                break;
              }
            }
            
            // Try multiple selectors for price
            const priceSelectors = ['.uitk-type-500', '.price', '[data-testid*="price"]'];
            let price = null;
            
            for (const priceSelector of priceSelectors) {
              const priceEl = card.querySelector(priceSelector);
              if (priceEl) {
                const priceMatch = priceEl.textContent.match(/£([\d,]+)/);
                if (priceMatch) {
                  price = parseInt(priceMatch[1].replace(',', ''));
                  break;
                }
              }
            }
            
            // Only add if we have both name and reasonable price
            if (roomName && price && price >= 200 && price <= 3000) {
              // Avoid duplicates
              const existing = rates.find(r => r.roomName === roomName && r.price === price);
              if (!existing) {
                rates.push({
                  ota: 'Expedia',
                  roomName: roomName,
                  price: price,
                  currency: 'GBP'
                });
              }
            }
          } catch (e) {
            // Skip this card
          }
        });
        
        // If we found rates with this selector, break
        if (rates.length > 0) break;
      }
      
      return rates;
    });
    
    return rooms;
    
  } catch (error) {
    console.error('Expedia scraping error:', error);
    return [];
  }
}

async function scrapeBooking(page) {
  const url = 'https://www.booking.com/hotel/gb/the-standard-london.html?checkin=2025-05-31&checkout=2025-06-01&group_adults=2&no_rooms=1';
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(8000);
    
    // Handle popups
    try {
      await page.click('[aria-label*="Dismiss"], [aria-label*="Close"]', { timeout: 3000 });
    } catch (e) {}
    
    const rooms = await page.evaluate(() => {
      const rates = [];
      
      // Multiple selectors for Booking.com
      const selectors = [
        '[data-testid*="room"]',
        '.hprt-table tr',
        '.room-table tr',
        '.bui-card'
      ];
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        
        elements.forEach(element => {
          try {
            // Find room name
            const nameSelectors = ['[data-testid*="title"]', '.hprt-roomtype-icon-link', 'h3', '.room-name'];
            let roomName = null;
            
            for (const nameSelector of nameSelectors) {
              const nameEl = element.querySelector(nameSelector);
              if (nameEl && nameEl.textContent.length > 5) {
                roomName = nameEl.textContent.trim();
                break;
              }
            }
            
            // Find price
            const priceSelectors = ['[data-testid*="price"]', '.bui-price-display__value', '.price'];
            let price = null;
            
            for (const priceSelector of priceSelectors) {
              const priceEl = element.querySelector(priceSelector);
              if (priceEl) {
                const priceMatch = priceEl.textContent.match(/[£$]?([\d,]+)/);
                if (priceMatch) {
                  price = parseInt(priceMatch[1].replace(',', ''));
                  break;
                }
              }
            }
            
            if (roomName && price && price >= 200 && price <= 3000) {
              const existing = rates.find(r => r.roomName === roomName && r.price === price);
              if (!existing) {
                rates.push({
                  ota: 'Booking.com',
                  roomName: roomName,
                  price: price,
                  currency: 'GBP'
                });
              }
            }
          } catch (e) {
            // Skip this element
          }
        });
        
        if (rates.length > 0) break;
      }
      
      return rates;
    });
    
    return rooms;
    
  } catch (error) {
    console.error('Booking.com scraping error:', error);
    return [];
  }
}

// Run the scraper
scrapeHotelRates().catch(console.error);
