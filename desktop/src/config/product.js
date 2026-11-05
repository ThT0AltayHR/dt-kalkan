'use strict';
// ─────────────────────────────────────────────────────────────
//  Single source of truth for branding. Rename the product here.
//  (Also run `npm run sync-brand` to propagate to package.json build config.)
// ─────────────────────────────────────────────────────────────
const PRODUCT = {
  name: 'DT Kalkan',              // visible product name
  shortName: 'Kalkan',            // short label used in tight spots
  company: 'Development Turkey',
  appId: 'com.developmentturkey.kalkan',
  executableName: 'DT Kalkan',    // main (elevated) executable
  notchExecutableSuffix: ' Island', // second, non-elevated executable for the notch
  version: '1.0.0',
  year: 2026,
  website: 'https://developmentturkey.com',
  supportEmail: 'destek@developmentturkey.com',
};
PRODUCT.copyright = `© ${PRODUCT.year} ${PRODUCT.company}. Tüm hakları saklıdır.`;
PRODUCT.copyrightEn = `© ${PRODUCT.year} ${PRODUCT.company}. All rights reserved.`;
PRODUCT.notchExecutableName = PRODUCT.executableName + PRODUCT.notchExecutableSuffix;
module.exports = PRODUCT;
