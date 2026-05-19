#!/usr/bin/env node

const path = require('path');

const packageJson = require('./package.json');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

const criticalDependencies = new Set([
  'express',
  'jsonwebtoken',
  'bcryptjs',
  'helmet',
  'cors',
  'dotenv'
]);

function color(colorName, message) {
  return `${colors[colorName]}${message}${colors.reset}`;
}

function dependencyNames() {
  return Object.keys(packageJson.dependencies || {}).sort();
}

function isInstalled(pkg) {
  try {
    require.resolve(pkg, { paths: [path.join(__dirname, 'node_modules'), __dirname] });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const deps = dependencyNames();
  const missing = [];

  console.log(color('blue', '\neasy.js dependency verification\n'));

  for (const dep of deps) {
    if (isInstalled(dep)) {
      console.log(`${color('green', 'OK')} ${dep}`);
    } else {
      const critical = criticalDependencies.has(dep);
      console.log(`${color(critical ? 'red' : 'yellow', critical ? 'MISSING' : 'OPTIONAL')} ${dep}${critical ? ' (critical)' : ''}`);
      missing.push(dep);
    }
  }

  const criticalMissing = missing.filter(dep => criticalDependencies.has(dep));

  console.log('\nSummary');
  console.log(`${color('green', 'Installed')}: ${deps.length - missing.length}`);
  console.log(`${color(missing.length ? 'yellow' : 'green', 'Missing')}: ${missing.length}`);

  if (missing.length) {
    console.log('\nInstall missing packages with:');
    console.log(`npm install ${missing.join(' ')}`);
  }

  if (criticalMissing.length) {
    console.log(color('red', '\nCritical dependencies are missing. The framework cannot start safely.'));
    process.exit(1);
  }

  console.log(color('green', '\nDependency verification complete.\n'));
}

main();
