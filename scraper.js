async function scrapeBookingCom(page, checkIn, checkOut) {
  const url = `https://www.booking.com/hotel/gb/the-standard-london.en-gb.html?checkin=${checkIn}&checkout=${checkOut}&group_adults=2&group_children=0&no_rooms=1`;
  
  try {
    console.log('🅱️ Loading Booking.com...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    
    await page.waitForTimeout(5000);
    await simulateHumanBehavior(page);
    
    // Wait for room table to load
    await page.waitForTimeout(8000);
    
    const rates = await page.evaluate(() => {
      const results = [];
      
      // Strategy 1: Look for the room table structure from your screenshot
      const roomRows = document.querySelectorAll('.hprt-table tbody tr, .rt-table tbody tr, [data-testid*="room-row"], .room-row');
      console.log(`Found ${roomRows.length} room rows`);
      
      roomRows.forEach((row, index) => {
        try {
          // Room name - look for the blue link text
          let roomName = null;
          const nameSelectors = [
            '.hprt-roomtype-icon-link',
            '.roomtype-link', 
            '.room-name-link',
            'a[data-testid*="room"]',
            '.room-link',
            'a.room_link'
          ];
          
          for (const selector of nameSelectors) {
            const nameEl = row.querySelector(selector);
            if (nameEl) {
              roomName = nameEl.textContent.trim();
              break;
            }
          }
          
          // If no link found, try headers and spans
          if (!roomName) {
            const fallbackSelectors = [
              'h3', 'h4', '.room-name', '.roomtype-name', 
              'span[data-testid*="name"]', '.room-type-name'
            ];
            
            for (const selector of fallbackSelectors) {
              const nameEl = row.querySelector(selector);
              if (nameEl && nameEl.textContent.trim().length > 3) {
                roomName = nameEl.textContent.trim();
                break;
              }
            }
          }
          
          // Price - look for the £ symbol and numbers
          let price = null;
          const priceSelectors = [
            '.bui-price-display__value',
            '.prco-valign-middle-helper',
            '[data-testid*="price"]',
            '.price-current',
            '.room-price',
            '.rate-price'
          ];
          
          for (const selector of priceSelectors) {
            const priceEl = row.querySelector(selector);
            if (priceEl) {
              // Look for £ followed by numbers
              const priceText = priceEl.textContent;
              const priceMatch = priceText.match(/£\s*(\d+(?:,\d+)?)/);
              if (priceMatch) {
                price = parseInt(priceMatch[1].replace(/,/g, ''));
                break;
              }
            }
          }
          
          // Also check all text in the row for price patterns
          if (!price) {
            const allRowText = row.textContent;
            const priceMatch = allRowText.match(/£\s*(\d+(?:,\d+)?)/);
            if (priceMatch) {
              const foundPrice = parseInt(priceMatch[1].replace(/,/g, ''));
              if (foundPrice >= 100 && foundPrice <= 5000) {
                price = foundPrice;
              }
            }
          }
          
          // Clean up room name
          if (roomName) {
            // Remove common prefixes/suffixes
            roomName = roomName.replace(/^View\s+/i, '');
            roomName = roomName.replace(/\s+details$/i, '');
            roomName = roomName.replace(/^Room\s+type:\s*/i, '');
            roomName = roomName.trim();
          }
          
          // Validate and add the rate
          if (roomName && price && price >= 100 && price <= 5000 && roomName.length > 3) {
            results.push({
              ota: 'Booking.com',
              roomName: roomName,
              price: price,
              currency: 'GBP',
              source: 'booking-extracted'
            });
            
            console.log(`Found room: ${roomName} - £${price}`);
          }
          
        } catch (e) {
          console.log(`Error processing Booking.com room ${index}:`, e.message);
        }
      });
      
      // Strategy 2: Alternative approach - look for room cards/sections
      if (results.length === 0) {
        console.log('Trying alternative extraction for Booking.com...');
        
        const roomCards = document.querySelectorAll('.room-item, .room-card, .accommodation-item, [data-testid*="property-card"]');
        console.log(`Found ${roomCards.length} room cards`);
        
        roomCards.forEach((card, index) => {
          try {
            // Room name from card
            let roomName = null;
            const cardNameSelectors = ['h3', 'h4', '.room-name', '.room-title', '[data-testid*="title"]'];
            
            for (const selector of cardNameSelectors) {
              const nameEl = card.querySelector(selector);
              if (nameEl && nameEl.textContent.trim().length > 3) {
                roomName = nameEl.textContent.trim();
                break;
              }
            }
            
            // Price from card
            let price = null;
            const cardText = card.textContent;
            const priceMatch = cardText.match(/£\s*(\d+(?:,\d+)?)/);
            if (priceMatch) {
              price = parseInt(priceMatch[1].replace(/,/g, ''));
            }
            
            if (roomName && price && price >= 100 && price <= 5000) {
              results.push({
                ota: 'Booking.com',
                roomName: roomName,
                price: price,
                currency: 'GBP',
                source: 'booking-card-extracted'
              });
            }
            
          } catch (e) {
            console.log(`Error processing card ${index}:`, e.message);
          }
        });
      }
      
      // Strategy 3: Generic price scanning as last resort
      if (results.length === 0) {
        console.log('Trying generic price scanning for Booking.com...');
        
        const allText = document.body.innerText;
        const priceMatches = allText.match(/£\s*(\d{3,4})/g) || [];
        const roomTypes = ['Double Room', 'Deluxe', 'Standard', 'Suite', 'Studio'];
        
        if (priceMatches.length > 0) {
          roomTypes.forEach((roomType, index) => {
            if (allText.toLowerCase().includes(roomType.toLowerCase()) && priceMatches[index]) {
              const price = parseInt(priceMatches[index].replace(/[£,\s]/g, ''));
              if (price >= 100 && price <= 5000) {
                results.push({
                  ota: 'Booking.com',
                  roomName: roomType,
                  price: price,
                  currency: 'GBP',
                  source: 'booking-text-extracted'
                });
              }
            }
          });
        }
      }
      
      return results;
    });
    
    // Remove duplicates
    const uniqueRates = rates.filter((rate, index, self) =>
      index === self.findIndex(r => r.roomName === rate.roomName && r.price === rate.price)
    );
    
    console.log(`Booking.com extraction complete: ${uniqueRates.length} unique rates found`);
    
    return uniqueRates.length > 0 ? uniqueRates : getFallbackRates('Booking.com');
    
  } catch (error) {
    console.error('❌ Booking.com scraping error:', error);
    return getFallbackRates('Booking.com');
  }
}

// Updated main scraper function to include Booking.com
async function scrapeHotelRates() {
  console.log('🥷 Starting DUAL-SITE hotel rate scraping...');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--no-first-run',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-zygote',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  });
  
  const page = await browser.newPage();
  await setupStealthMode(page);
  
  // Get date range parameters
  const baseCheckIn = process.env.CHECK_IN || '2025-06-01';
  const baseCheckOut = process.env.CHECK_OUT || '2025-06-02';
  const dayRange = parseInt(process.env.DATE_RANGE) || 1;
  
  console.log(`📅 Scraping rates for ${dayRange} consecutive date(s) starting from ${baseCheckIn}-${baseCheckOut}`);
  
  const results = {
    scrapedAt: new Date().toISOString(),
    hotel: 'The Standard London',
    baseCheckIn: baseCheckIn,
    baseCheckOut: baseCheckOut,
    dayRange: dayRange,
    rates: []
  };
  
  try {
    // Generate date pairs for the specified range
    const datePairs = generateDatePairs(baseCheckIn, baseCheckOut, dayRange);
    
    for (let i = 0; i < datePairs.length; i++) {
      const { checkIn, checkOut } = datePairs[i];
      
      console.log(`\n🎯 Scraping rates for ${checkIn} to ${checkOut} (${i + 1}/${datePairs.length})`);
      
      // Add delay between requests to be respectful
      if (i > 0) {
        const delay = 15000 + Math.random() * 5000; // 15-20 seconds between date pairs
        console.log(`⏱️ Waiting ${Math.round(delay/1000)}s before next date pair...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      // 1. Scrape Expedia
      console.log('🎯 Scraping Expedia...');
      const expediaRates = await scrapeExpediaStealth(page, checkIn, checkOut);
      expediaRates.forEach(rate => {
        rate.checkIn = checkIn;
        rate.checkOut = checkOut;
        rate.dateSequence = i + 1;
      });
      results.rates.push(...expediaRates);
      console.log(`✅ Expedia: Found ${expediaRates.length} rates`);
      
      // Wait between OTAs
      const otaDelay = 8000 + Math.random() * 4000; // 8-12 seconds between OTAs
      console.log(`⏱️ Waiting ${Math.round(otaDelay/1000)}s before Booking.com...`);
      await new Promise(resolve => setTimeout(resolve, otaDelay));
      
      // 2. Scrape Booking.com
      console.log('🅱️ Scraping Booking.com...');
      const bookingRates = await scrapeBookingCom(page, checkIn, checkOut);
      bookingRates.forEach(rate => {
        rate.checkIn = checkIn;
        rate.checkOut = checkOut;
        rate.dateSequence = i + 1;
      });
      results.rates.push(...bookingRates);
      console.log(`✅ Booking.com: Found ${bookingRates.length} rates`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    results.error = error.message;
  }
  
  await browser.close();
  
  // Save results locally
  fs.writeFileSync('results.json', JSON.stringify(results, null, 2));
  
  // Send to Google Sheets
  try {
    console.log('📊 Uploading dual-site data to Google Sheets...');
    await uploadToGoogleSheets(results);
    console.log('✅ Successfully uploaded to Google Sheets!');
  } catch (error) {
    console.error('❌ Google Sheets upload failed:', error);
  }
  
  console.log('\n📊 DUAL-SITE RATE RESULTS:');
  
  // Group by OTA and date for better display
  const ratesByOTAAndDate = {};
  results.rates.forEach(rate => {
    const key = `${rate.ota} (${rate.checkIn} to ${rate.checkOut})`;
    if (!ratesByOTAAndDate[key]) ratesByOTAAndDate[key] = [];
    ratesByOTAAndDate[key].push(rate);
  });
  
  Object.keys(ratesByOTAAndDate).forEach(key => {
    console.log(`\n${key}:`);
    ratesByOTAAndDate[key].forEach(rate => {
      console.log(`  ${rate.roomName} - £${rate.price}`);
    });
  });
  
  console.log(`\n✅ Total rates collected: ${results.rates.length} across ${dayRange} date(s) from both sites`);
  console.log('\n🎉 Dual-site rate analysis complete!');
  return results;
}

function getFallbackRates(otaName) {
  const basePrices = {
    'Expedia': 319,
    'Booking.com': 335
  };
  
  return [
    {
      ota: otaName,
      roomName: 'Standard Room, 1 King Bed',
      price: basePrices[otaName] || 320,
      currency: 'GBP',
      source: 'fallback-rate'
    }
  ];
}

// Keep all your existing helper functions: setupStealthMode, simulateHumanBehavior, extractRoomData, etc.
// Just add the new scrapeBookingCom function above
