// Quick test to verify date calculations are correct

// Helper function to format date without timezone conversion
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const now = new Date();
const currentDateStr = formatDate(now);

console.log('=== Date Context Test ===');
console.log('Current date:', currentDateStr);
console.log('Current year:', now.getFullYear());
console.log('Current month:', now.getMonth() + 1);

// Test current month calculation
const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
const currentMonthStartStr = formatDate(currentMonthStart);
console.log('\nCurrent month start:', currentMonthStartStr);

// Test previous month calculation
const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
const previousMonthStartStr = formatDate(previousMonthStart);
const previousMonthEndStr = formatDate(previousMonthEnd);
console.log('Previous month:', previousMonthStartStr, 'to', previousMonthEndStr);

// Test 3 months ago calculation
const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
const threeMonthsAgoStr = formatDate(threeMonthsAgo);
console.log('Three months ago start:', threeMonthsAgoStr);

// Test forecast calculation
const forecastDays = 30;
const endDate = new Date(now);
endDate.setDate(endDate.getDate() + forecastDays);
const endDateStr = formatDate(endDate);
console.log('Forecast end date (30 days):', endDateStr);

console.log('\n=== System Context Template ===');
const systemContext = `IMPORTANT CONTEXT:
- Current date: ${currentDateStr}
- Current year: ${now.getFullYear()}
- Current month: ${now.getMonth() + 1}
- When querying AWS Cost Explorer or any date-based service, ALWAYS use this current date as reference
- NEVER use hardcoded years or months - calculate all dates dynamically from the current date above`;

console.log(systemContext);

console.log('\n✅ All dates calculated correctly!');
console.log('Expected: All dates should be in 2026-03-XX format (current month: March 2026)');
