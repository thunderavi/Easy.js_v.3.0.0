#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const Logger = require('../core/logger');
const Parser = require('../parser/Parser');
const Compiler = require('../compiler/Compiler');
const { TypeChecker, Formatter, Linter, Repl, Playground } = require('../language');

const PROVIDER_PACKAGES = {
  mongodb: { label: 'MongoDB', packages: ['mongoose'], connection: 'mongodb://localhost:27017/app' },
  mongo: { label: 'MongoDB', packages: ['mongoose'], connection: 'mongodb://localhost:27017/app' },
  postgres: { label: 'PostgreSQL', packages: ['pg'], connection: 'postgres://postgres:postgres@localhost:5432/app' },
  postgresql: { label: 'PostgreSQL', packages: ['pg'], connection: 'postgres://postgres:postgres@localhost:5432/app' },
  pg: { label: 'PostgreSQL', packages: ['pg'], connection: 'postgres://postgres:postgres@localhost:5432/app' },
  mysql: { label: 'MySQL', packages: ['mysql2'], connection: 'mysql://root:password@localhost:3306/app' },
  mariadb: { label: 'MariaDB', packages: ['mysql2'], connection: 'mysql://root:password@localhost:3306/app' },
  sqlite: { label: 'SQLite', packages: ['sql.js'], connection: './data/app.sqlite' },
  redis: { label: 'Redis', packages: ['redis'], connection: 'redis://localhost:6379' },
  supabase: { label: 'Supabase', packages: ['@supabase/supabase-js'], connection: 'SUPABASE_URL' },
  firebase: { label: 'Firebase', packages: ['firebase-admin'], connection: 'FIREBASE_PROJECT_ID' },
  firestore: { label: 'Firebase', packages: ['firebase-admin'], connection: 'FIREBASE_PROJECT_ID' },
  dynamodb: { label: 'DynamoDB', packages: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb'], connection: 'AWS_REGION' },
  elasticsearch: { label: 'Elasticsearch', packages: ['@elastic/elasticsearch'], connection: 'http://localhost:9200' },
  opensearch: { label: 'OpenSearch', packages: ['@elastic/elasticsearch'], connection: 'http://localhost:9200' },
  cassandra: { label: 'Cassandra', packages: ['cassandra-driver'], connection: '127.0.0.1' },
  neo4j: { label: 'Neo4j', packages: ['neo4j-driver'], connection: 'neo4j://localhost:7687' },
  mssql: { label: 'SQL Server', packages: ['mssql'], connection: 'sqlserver://user:password@localhost:1433/app' },
  libsql: { label: 'libSQL', packages: ['@libsql/client'], connection: 'file:local.db' },
  turso: { label: 'Turso', packages: ['@libsql/client'], connection: 'libsql://database.turso.io' }
};

const UI_PRESETS = {
  plain: { label: 'Plain HTML', packages: [] },
  bootstrap: { label: 'Bootstrap', packages: ['bootstrap'] },
  tailwind: { label: 'Tailwind CSS', packages: ['tailwindcss', 'postcss', 'autoprefixer'] }
};

const PACKAGE_VERSION_HINTS = {
  bootstrap: '^5.3.3',
  tailwindcss: '^3.4.17',
  postcss: '^8.4.31',
  autoprefixer: '^10.4.16'
};

class CLI {
  constructor(argv = process.argv) {
    this.command = argv[2];
    this.args = argv.slice(3);
  }

  async run() {
    switch (this.command) {
      case 'create':
        this.createProject();
        break;
      case 'start':
        this.startServer();
        break;
      case 'dev':
        this.devServer();
        break;
      case 'build':
        this.build();
        break;
      case 'doctor':
        this.doctor();
        break;
      case 'lint':
        this.lint();
        break;
      case 'format':
        this.format();
        break;
      case 'typecheck':
        this.typecheck();
        break;
      case 'repl':
        new Repl().start();
        break;
      case 'playground':
        this.playground();
        break;
      case 'add':
        this.addFeature();
        break;
      case 'migration':
        this.runMigrationCommand();
        break;
      case 'seed':
        this.runSeedCommand();
        break;
      case '--version':
      case '-v':
        this.showVersion();
        break;
      case '--help':
      case '-h':
        this.showHelp();
        break;
      default:
        this.showHelp();
    }
  }

  createProject() {
    const projectName = this.args[0];

    if (!projectName) {
      Logger.error('Project name is required');
      Logger.info('Usage: easyjs create <project-name>');
      process.exit(1);
    }

    const projectPath = path.join(process.cwd(), projectName);

    if (fs.existsSync(projectPath)) {
      Logger.error(`Directory '${projectName}' already exists`);
      process.exit(1);
    }

    Logger.info(`Creating secure backend: ${projectName}`);
    const uiPreset = this.getOption('ui', 'plain');

    for (const dir of [
      'src',
      'src/modules',
      'config',
      'tests/unit',
      'tests/integration',
      'template',
      'migrations',
      'seeds',
      'docs',
      '.github/workflows'
    ]) {
      fs.mkdirSync(path.join(projectPath, dir), { recursive: true });
    }

    this.writeProjectFiles(projectPath, projectName, uiPreset);

    Logger.success('Project created successfully');
    Logger.info(`Next steps:`);
    Logger.info(`  cd ${projectName}`);
    Logger.info(`  npm install`);
    Logger.info(`  npm run doctor`);
    Logger.info(`  npm run dev`);
  }

  writeProjectFiles(projectPath, projectName, uiPreset = 'plain') {
    const files = {
      'src/app.easy': this.templates.appEasy(projectName),
      'src/models.easy': this.templates.modelsEasy(),
      'src/auth.easy': this.templates.authEasy(),
      'src/routes.easy': this.templates.routesEasy(),
      'src/jobs.easy': this.templates.jobsEasy(),
      'config/easy.config.js': this.templates.easyConfig(),
      'tests/integration/health.test.js': this.templates.healthTest(),
      'template/index.html': this.templates.templateIndex(projectName, uiPreset),
      'template/styles.css': this.templates.templateStyles(uiPreset),
      'template/api.js': this.templates.templateApi(),
      'template/app.js': this.templates.templateApp(),
      'migrations/001_create_users_table.js': this.templates.userMigration(),
      'seeds/001_admin_user.js': this.templates.adminSeed(),
      'docs/API.md': this.templates.apiDocs(projectName),
      '.env': this.templates.env(projectName),
      '.env.example': this.templates.envExample(),
      '.gitignore': this.templates.gitignore(),
      'Dockerfile': this.templates.dockerfile(),
      'docker-compose.yml': this.templates.dockerCompose(projectName),
      '.github/workflows/ci.yml': this.templates.ciWorkflow(),
      ...(uiPreset === 'tailwind' ? {
        'template/input.css': this.templates.tailwindInput(),
        'tailwind.config.js': this.templates.tailwindConfig()
      } : {}),
      'package.json': JSON.stringify(this.templates.packageJson(projectName, uiPreset), null, 2),
      'README.md': this.templates.readme(projectName)
    };

    for (const [filename, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(projectPath, filename), content);
    }
  }

  addFeature() {
    const feature = this.args[0];
    const name = this.args[1];

    if (!feature) {
      Logger.error('Feature name is required');
      Logger.info('Usage: easyjs add <model|route|crud|auth|database|ui|page|job> <name>');
      process.exit(1);
    }

    if (feature === 'model') {
      if (!name) return this.missingName('model');
      this.appendFile('src/models.easy', `\nMODEL ${name} {\n  name: string\n  createdAt: date\n}\n`);
      Logger.success(`Model added: ${name}`);
      return;
    }

    if (feature === 'crud') {
      if (!name) return this.missingName('crud');
      const routeName = name.toLowerCase();
      this.appendFile('src/routes.easy', `\nGET /${routeName} FROM ${routeName}\nGET /${routeName}/:id FROM ${routeName}\nPOST /${routeName} FROM ${routeName}\nPUT /${routeName}/:id FROM ${routeName}\nDELETE /${routeName}/:id FROM ${routeName}\nPROTECT /${routeName}\n`);
      Logger.success(`CRUD routes added for: ${name}`);
      return;
    }

    if (feature === 'route') {
      if (!name) return this.missingName('route');
      const routeName = name.toLowerCase().replace(/^\//, '');
      this.appendFile('src/routes.easy', `\nGET /${routeName} FROM ${routeName}\nPOST /${routeName} FROM ${routeName}\n`);
      Logger.success(`Routes added for: ${routeName}`);
      return;
    }

    if (feature === 'auth') {
      const strategy = (name || 'jwt').toLowerCase();
      if (strategy !== 'jwt') {
        Logger.error(`Unsupported auth strategy: ${strategy}`);
        Logger.info('Usage: easyjs add auth jwt');
        process.exit(1);
      }
      this.appendFile('src/auth.easy', `\nAUTH users BY jwt\nPROTECT /users\n`);
      Logger.success('JWT auth added for users');
      return;
    }

    if (feature === 'database') {
      if (!name) return this.missingName('database');
      this.addDatabase(name);
      return;
    }

    if (feature === 'ui') {
      if (!name) return this.missingName('ui');
      this.addUiPreset(name);
      return;
    }

    if (feature === 'page') {
      if (!name) return this.missingName('page');
      this.addTemplatePage(name);
      return;
    }

    if (feature === 'job') {
      if (!name) return this.missingName('job');
      this.appendFile('src/jobs.easy', `\nJOB ${name} EVERY 5m {\n  LOG \"${name} running\"\n}\n`);
      Logger.success(`Job added: ${name}`);
      return;
    }

    Logger.error(`Unknown feature: ${feature}`);
  }

  missingName(feature) {
    Logger.error(`Name is required for ${feature}`);
    process.exit(1);
  }

  appendFile(filename, content) {
    const filepath = path.join(process.cwd(), filename);
    if (!fs.existsSync(filepath)) {
      fs.mkdirSync(path.dirname(filepath), { recursive: true });
      fs.writeFileSync(filepath, '');
    }
    fs.appendFileSync(filepath, content);
  }

  addDatabase(name) {
    const provider = this.normalizeProvider(name);
    const info = PROVIDER_PACKAGES[provider];
    if (!info) {
      Logger.error(`Unsupported database provider: ${name}`);
      Logger.info(`Supported: ${Object.keys(PROVIDER_PACKAGES).sort().join(', ')}`);
      process.exit(1);
    }

    const file = this.defaultEasyFile();
    const filepath = path.resolve(process.cwd(), file);
    const source = fs.existsSync(filepath) ? fs.readFileSync(filepath, 'utf8') : '';
    const directive = `USE ${provider.toUpperCase()} ${info.connection}`;
    const nextSource = source.match(/^\s*USE\s+\S+\s+.+$/im)
      ? source.replace(/^\s*USE\s+\S+\s+.+$/im, directive)
      : `${source.trimEnd()}\n\n${directive}\n`;

    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, nextSource);
    const added = this.ensureProjectDependencies(info.packages);

    Logger.success(`${info.label} configured in ${file}`);
    if (added.length) {
      Logger.info(`Added dependencies to package.json: ${added.join(', ')}`);
      Logger.info(`Run npm install`);
    }
  }

  addUiPreset(name) {
    const preset = this.normalizeProvider(name);
    const info = UI_PRESETS[preset];
    if (!info) {
      Logger.error(`Unsupported UI preset: ${name}`);
      Logger.info(`Supported: ${Object.keys(UI_PRESETS).join(', ')}`);
      process.exit(1);
    }

    fs.mkdirSync(path.join(process.cwd(), 'template'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), 'template', 'index.html'), this.templates.templateIndex(this.projectNameFromPackage(), preset));
    fs.writeFileSync(path.join(process.cwd(), 'template', 'styles.css'), this.templates.templateStyles(preset));
    fs.writeFileSync(path.join(process.cwd(), 'template', 'api.js'), this.templates.templateApi());
    fs.writeFileSync(path.join(process.cwd(), 'template', 'app.js'), this.templates.templateApp());
    if (preset === 'tailwind') {
      fs.writeFileSync(path.join(process.cwd(), 'template', 'input.css'), this.templates.tailwindInput());
      fs.writeFileSync(path.join(process.cwd(), 'tailwind.config.js'), this.templates.tailwindConfig());
      this.ensurePackageScripts({ 'ui:build': 'tailwindcss -i ./template/input.css -o ./template/styles.css' });
    }

    const added = this.ensureProjectDependencies(info.packages);
    Logger.success(`${info.label} UI template installed`);
    if (added.length) {
      Logger.info(`Added dependencies to package.json: ${added.join(', ')}`);
      Logger.info('Run npm install');
      if (preset === 'tailwind') Logger.info('Then run npm run ui:build');
    }
  }

  addTemplatePage(name) {
    const pageName = this.normalizePageName(name);
    const title = this.toTitle(pageName);
    const templateDir = path.join(process.cwd(), 'template');
    const pagesDir = path.join(templateDir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });
    const pagePath = path.join(pagesDir, `${pageName}.html`);

    if (fs.existsSync(pagePath)) {
      Logger.error(`Page already exists: template/pages/${pageName}.html`);
      process.exit(1);
    }

    fs.writeFileSync(pagePath, this.templates.templatePage(title));
    this.ensureTemplateApi();
    this.ensurePageLink(pageName, title);
    Logger.success(`Page added: template/pages/${pageName}.html`);
  }

  ensureTemplateApi() {
    const apiPath = path.join(process.cwd(), 'template', 'api.js');
    if (!fs.existsSync(apiPath)) {
      fs.mkdirSync(path.dirname(apiPath), { recursive: true });
      fs.writeFileSync(apiPath, this.templates.templateApi());
    }
  }

  ensurePageLink(pageName, title) {
    const indexPath = path.join(process.cwd(), 'template', 'index.html');
    if (!fs.existsSync(indexPath)) return;
    const href = `/template/pages/${pageName}.html`;
    const source = fs.readFileSync(indexPath, 'utf8');
    if (source.includes(href)) return;
    const link = `        <a href="${href}">${title}</a>\n`;
    const nextSource = source.includes('<!-- easy.js pages -->')
      ? source.replace('<!-- easy.js pages -->', `${link}        <!-- easy.js pages -->`)
      : source.replace('</header>', `      <nav class="pages">\n${link}      </nav>\n    </header>`);
    fs.writeFileSync(indexPath, nextSource);
  }

  normalizePageName(name) {
    const normalized = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!normalized) {
      Logger.error('Page name must include a letter or number');
      process.exit(1);
    }
    return normalized;
  }

  toTitle(name) {
    return String(name).split('-').filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }

  doctor() {
    const providerChecks = this.checkProviderDependencies();
    const checks = [
      this.checkFile('package.json', 'Project package'),
      this.checkFile('src/app.easy', 'Main easy.js app'),
      this.checkFile('.env', 'Environment file'),
      this.checkFile('.env.example', 'Environment example'),
      this.checkFile('Dockerfile', 'Docker support'),
      this.checkFile('docker-compose.yml', 'Local services'),
      this.checkEnv('JWT_SECRET', 'JWT secret'),
      this.checkEnv('DATABASE_URL', 'Database URL', false)
    ];

    const failed = checks.filter(check => !check.ok).concat(providerChecks.filter(check => !check.ok));

    checks.forEach(check => {
      const label = check.ok ? 'OK' : (check.required ? 'MISSING' : 'WARN');
      Logger.info(`${label}: ${check.name}`);
    });

    providerChecks.forEach(check => {
      if (check.ok) {
        Logger.info(`OK: ${check.name}`);
      } else {
        Logger.error(check.message);
      }
    });

    if (failed.some(check => check.required)) {
      Logger.error('Doctor found required fixes.');
      process.exit(1);
    }

    Logger.success('Doctor checks passed');
  }

  lint() {
    const file = this.args[0] || this.defaultEasyFile();
    const source = this.readEasySource(file);
    const ast = new Parser().parse(source);
    const diagnostics = new Linter().lint(source, ast);
    diagnostics.forEach(item => Logger.info(`${item.severity.toUpperCase()} ${item.code}: ${item.message} (${item.line}:${item.column})`));
    if (diagnostics.some(item => item.severity === 'error')) process.exit(1);
    Logger.success('easy.js lint complete');
  }

  format() {
    const file = this.args[0] || this.defaultEasyFile();
    const filepath = path.resolve(process.cwd(), file);
    const formatted = new Formatter().format(fs.readFileSync(filepath, 'utf8'));
    fs.writeFileSync(filepath, formatted);
    Logger.success(`Formatted ${file}`);
  }

  typecheck() {
    const file = this.args[0] || this.defaultEasyFile();
    const source = this.readEasySource(file);
    const ast = new Parser().parse(source);
    const result = new TypeChecker().check(ast);
    result.errors.forEach(error => Logger.error(`${error.code}: ${error.message}`));
    if (!result.ok) process.exit(1);
    Logger.success('easy.js typecheck passed');
  }

  playground() {
    const file = this.args[0] || this.defaultEasyFile();
    const result = new Playground().run(this.readEasySource(file));
    Logger.info(JSON.stringify({
      models: result.config?.models?.length || 0,
      routes: result.config?.routes?.length || 0,
      diagnostics: result.diagnostics,
      typeErrors: result.types.errors
    }, null, 2));
  }

  readEasySource(file) {
    const ModuleResolver = require('../language/ModuleResolver');
    return new ModuleResolver().resolve(path.resolve(process.cwd(), file));
  }

  defaultEasyFile() {
    const candidates = ['src/app.easy', 'app.easy', 'examples/quickstart.easy'];
    const found = candidates.find(candidate => fs.existsSync(path.resolve(process.cwd(), candidate)));
    return found || 'src/app.easy';
  }

  checkFile(filename, name, required = true) {
    return { name, required, ok: fs.existsSync(path.join(process.cwd(), filename)) };
  }

  checkEnv(key, name, required = true) {
    const envPath = path.join(process.cwd(), '.env');
    const env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    return { name, required, ok: env.includes(`${key}=`) };
  }

  checkProviderDependencies(file = this.defaultEasyFile()) {
    const providers = this.detectProviders(file);
    const checks = [];

    for (const provider of providers) {
      const info = PROVIDER_PACKAGES[provider];
      if (!info) continue;
      for (const pkg of info.packages) {
        const installed = this.isPackageInstalled(pkg);
        checks.push({
          name: `${info.label} driver ${pkg}`,
          required: true,
          ok: installed,
          message: `You use ${info.label} but ${pkg} is missing. Run npm install ${pkg}.`
        });
      }
    }

    return checks;
  }

  detectProviders(file = this.defaultEasyFile()) {
    try {
      const source = this.readEasySource(file);
      const providers = new Set();
      const pattern = /^\s*USE\s+([A-Z0-9_]+)\b/gim;
      let match;
      while ((match = pattern.exec(source))) {
        providers.add(this.normalizeProvider(match[1]));
      }
      return Array.from(providers);
    } catch {
      return [];
    }
  }

  normalizeProvider(provider) {
    return String(provider || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  readProjectDependencies() {
    const packagePath = path.join(process.cwd(), 'package.json');
    if (!fs.existsSync(packagePath)) return {};
    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      return {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
        ...(pkg.optionalDependencies || {}),
        ...(pkg.peerDependencies || {})
      };
    } catch {
      return {};
    }
  }

  ensureProjectDependencies(packages) {
    const packagePath = path.join(process.cwd(), 'package.json');
    if (!fs.existsSync(packagePath)) return [];
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    pkg.dependencies = pkg.dependencies || {};
    const added = [];
    for (const packageName of packages) {
      if (!pkg.dependencies[packageName]) {
        pkg.dependencies[packageName] = this.packageVersionFor(packageName);
        added.push(packageName);
      }
    }
    if (added.length) {
      fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    }
    return added;
  }

  ensurePackageScripts(scripts) {
    const packagePath = path.join(process.cwd(), 'package.json');
    if (!fs.existsSync(packagePath)) return;
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    pkg.scripts = { ...(pkg.scripts || {}), ...scripts };
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  projectNameFromPackage() {
    const packagePath = path.join(process.cwd(), 'package.json');
    if (!fs.existsSync(packagePath)) return 'easy-ui';
    try {
      return JSON.parse(fs.readFileSync(packagePath, 'utf8')).name || 'easy-ui';
    } catch {
      return 'easy-ui';
    }
  }

  packageVersionFor(packageName) {
    const rootPackage = require('../package.json');
    return PACKAGE_VERSION_HINTS[packageName] || rootPackage.peerDependencies?.[packageName] || 'latest';
  }

  frameworkVersion() {
    return require('../package.json').version;
  }

  isPackageInstalled(packageName) {
    try {
      require.resolve(packageName, { paths: [process.cwd()] });
      return true;
    } catch {
      return false;
    }
  }

  startServer() {
    const filePath = this.args[0] || './src/app.easy';
    this.ensureRuntimeReady(filePath);
    Logger.info(`Starting server with ${filePath}...`);
    this.runEasyJS(filePath);
  }

  devServer() {
    const filePath = this.args[0] || './src/app.easy';
    this.ensureRuntimeReady(filePath);
    Logger.info(`Starting development server with ${filePath}...`);
    this.runWithWatcher(filePath);
  }

  ensureRuntimeReady(filePath) {
    const missing = this.checkProviderDependencies(filePath).filter(check => !check.ok);
    if (missing.length) {
      missing.forEach(check => Logger.error(check.message));
      process.exit(1);
    }
  }

  build() {
    Logger.info('Building project...');
    Logger.success('Build complete');
  }

  runMigrationCommand() {
    const subcommand = this.args[0] || 'latest';
    const name = this.args[1] || 'migration';
    const commands = {
      latest: 'npm run migrate:latest',
      rollback: 'npm run migrate:rollback',
      make: `npm run migrate:create -- ${name}`
    };
    this.runShell(commands[subcommand] || commands.latest);
  }

  runSeedCommand() {
    const subcommand = this.args[0] || 'run';
    const name = this.args[1] || 'seed';
    const commands = {
      run: 'npm run seed:run',
      make: `npm run seed:create -- ${name}`
    };
    this.runShell(commands[subcommand] || commands.run);
  }

  showVersion() {
    const packageJson = require('../package.json');
    Logger.info(`easy.js v${packageJson.version}`);
  }

  showHelp() {
    Logger.info(`
easy.js CLI

Usage:
  easyjs <command> [options]

Commands:
  create <name>        Create a secure backend project
  start [file]         Start the server
  dev [file]           Start in development mode with watch
  doctor               Check project setup and security basics
  lint [file]          Lint easy.js source
  format [file]        Format easy.js source
  typecheck [file]     Type-check easy.js source
  repl                 Open the easy.js REPL
  playground [file]    Analyze source and print language summary
  add model <name>     Add a model block
  add route <name>     Add simple GET/POST routes
  add crud <name>      Add protected CRUD routes
  add auth jwt         Add JWT auth declarations
  add database <name>  Configure database and package dependency
  add ui <preset>      Add UI preset: plain, bootstrap, tailwind
  add page <name>      Add an HTML page in template/pages
  add job <name>       Add a scheduled job block
  build                Build for production
  migration <command>  Migration commands: latest, rollback, make <name>
  seed <command>       Seed commands: run, make <name>

Examples:
  easyjs create my-api
  easyjs add model Post
  easyjs add database postgres
  easyjs add ui bootstrap
  easyjs add page dashboard
  easyjs add route posts
  easyjs doctor
`);
  }
activeChildProcess = null;

  runEasyJS(filePath) {
    const { spawn } = require('child_process');
    const indexPath = path.resolve(__dirname, '../index.js');

    if (this.activeChildProcess) {
      this.activeChildProcess.kill('SIGTERM');
      this.activeChildProcess = null;
    }

    const child = spawn('node', [indexPath, filePath], { stdio: 'inherit' });
    this.activeChildProcess = child;

    
    child.on('error', (error) => {
      Logger.error(`Failed to start process: ${error.message}`);
    });

    child.on('close', (code) => {
      if (this.activeChildProcess === child) {
        this.activeChildProcess = null;
      }
    });
  }
  runWithWatcher(filePath) {
    const dir = path.dirname(filePath);
    Logger.info(`Watching directory: ${dir}`);
    this.runEasyJS(filePath);

    fs.watch(dir, { recursive: true }, (eventType, filename) => {
      if (filename && filename.endsWith('.easy')) {
        Logger.info(`File changed: ${filename}`);
        Logger.info('Restarting server cleanly...');
        this.runEasyJS(filePath);
      }
    });
  }

  runShell(command) {
    exec(command, (error, stdout, stderr) => {
      if (stdout) Logger.info(stdout.trim());
      if (stderr) Logger.warn(stderr.trim());
      if (error) {
        Logger.error(error.message);
        process.exit(1);
      }
    });
  }

  getOption(name, fallback = null) {
    const prefix = `--${name}=`;
    const exact = `--${name}`;
    const inline = this.args.find(arg => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = this.args.indexOf(exact);
    if (index !== -1 && this.args[index + 1]) return this.args[index + 1];
    return fallback;
  }

  templates = {
    appEasy: (projectName) => `# ${projectName}
# One file starts the backend. Split files keep it readable.

START SERVER 3000
USE MONGODB mongodb://localhost:27017/${projectName.replace(/[^a-zA-Z0-9_-]/g, '')}

SECURITY strict
DOCS openapi
ADMIN enabled

IMPORT ./models.easy
IMPORT ./auth.easy
IMPORT ./routes.easy
IMPORT ./jobs.easy
`,

    modelsEasy: () => `MODEL users {
  name: string
  email: email
  password: password
  role: string
  emailVerified: boolean
  createdAt: date
}

MODEL posts {
  title: string
  content: string
  authorId: string
  published: boolean
  createdAt: date
}
`,

    authEasy: () => `AUTH users BY jwt
AUTH refresh_tokens enabled
AUTH password_reset enabled
AUTH email_verification enabled

ROLE admin CAN *
ROLE user CAN posts:read, posts:create
`,

    routesEasy: () => `GET /users FROM users
GET /users/:id FROM users
POST /users FROM users
PUT /users/:id FROM users
DELETE /users/:id FROM users
PROTECT /users

GET /posts FROM posts
GET /posts/:id FROM posts
POST /posts FROM posts
PUT /posts/:id FROM posts
DELETE /posts/:id FROM posts
PROTECT /posts

VALIDATE users {
  email: required:email
  password: required:min=8
  name: required:min=2
}

VALIDATE posts {
  title: required:min=3
  content: required
}
`,

    jobsEasy: () => `JOB cleanupExpiredTokens EVERY 1h {
  LOG "Cleaning expired auth tokens"
}
`,

    easyConfig: () => `module.exports = {
  security: 'strict',
  docs: true,
  admin: true,
  logging: true,
  healthChecks: true,
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100
  }
};
`,

    healthTest: () => `const request = require('supertest');
const AppFactory = require('easybackend.js').AppFactory;

describe('health', () => {
  it('returns health status', async () => {
    const factory = new AppFactory({ enableAdmin: false, enableSwagger: false });
    const app = await factory.initialize();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });
});
`,

    userMigration: () => `exports.up = async (knex) => {
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('email').notNullable().unique();
    table.string('password').notNullable();
    table.string('role').defaultTo('user');
    table.boolean('emailVerified').defaultTo(false);
    table.timestamps(true, true);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('users');
};
`,

    adminSeed: () => `exports.seed = async (knex) => {
  await knex('users').insert({
    name: 'Admin',
    email: 'admin@example.com',
    password: 'replace-with-hashed-password',
    role: 'admin',
    emailVerified: true
  });
};
`,

    apiDocs: (projectName) => `# ${projectName} API

Run the server:

\`\`\`bash
npm run dev
\`\`\`

Useful endpoints:

- GET /health
- GET /_health
- GET /ready
- GET /docs
- GET /posts
- POST /posts

Open http://localhost:3000/ for the starter UI.
`,

    templateIndex: (projectName, uiPreset = 'plain') => {
      const bootstrap = uiPreset === 'bootstrap';
      return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${projectName} - easy.js</title>
  ${bootstrap ? '<link rel="stylesheet" href="/vendor/bootstrap/css/bootstrap.min.css">' : ''}
  <link rel="stylesheet" href="/template/styles.css">
</head>
<body>
  <main class="shell ${bootstrap ? 'container py-5' : ''}">
    <header class="hero ${bootstrap ? 'border-bottom pb-4 mb-4' : ''}">
      <div class="mark ${bootstrap ? 'shadow-sm' : ''}" aria-hidden="true">E</div>
      <div>
        <p class="eyebrow">easy.js template</p>
        <h1>${projectName}</h1>
        <p class="lede">Edit files in the <code>template</code> folder to design this UI. The buttons below call your backend routes directly.</p>
      </div>
      <nav class="pages">
        <!-- easy.js pages -->
      </nav>
    </header>

    <section class="panel ${bootstrap ? 'card card-body shadow-sm' : ''}">
      <div class="panel-head ${bootstrap ? 'd-flex justify-content-between align-items-center' : ''}">
        <h2>API Explorer</h2>
        <button id="refresh" class="${bootstrap ? 'btn btn-outline-success btn-sm' : ''}">Refresh</button>
      </div>
      <div id="route-list" class="actions">
        <button class="${bootstrap ? 'btn btn-success' : ''}" data-method="GET" data-endpoint="/health">GET /health</button>
      </div>
      <label class="body-label" for="request-body">Request body</label>
      <textarea id="request-body" rows="7" spellcheck="false">{
  "name": "Ada Lovelace",
  "email": "ada@example.com"
}</textarea>
      <div class="toolbar">
        <button id="send" class="${bootstrap ? 'btn btn-success' : ''}">Send selected route</button>
        <button id="copy-curl" class="${bootstrap ? 'btn btn-outline-success' : ''}">Copy curl</button>
      </div>
      <pre id="output">Click an endpoint to see the backend response.</pre>
    </section>
  </main>
  <script src="/template/api.js"></script>
  <script src="/template/app.js"></script>
  ${bootstrap ? '<script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>' : ''}
</body>
</html>
`;
    },

    templateStyles: (uiPreset = 'plain') => `${uiPreset === 'tailwind' ? '/* Generated from template/input.css. Run npm run ui:build after editing Tailwind classes. */\n' : ''}:root {
  --bg: #f7faf6;
  --panel: #ffffff;
  --ink: #172316;
  --muted: #5d6b5a;
  --brand: #4d963f;
  --line: #dce7d7;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--ink);
}

.shell {
  width: min(1040px, calc(100% - 32px));
  margin: 0 auto;
  padding: 48px 0;
}

.hero {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 22px;
  align-items: center;
  padding-bottom: 28px;
  border-bottom: 1px solid var(--line);
}

.mark {
  width: 88px;
  height: 88px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--brand);
  color: white;
  font-size: 48px;
  font-weight: 800;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--brand);
  font-weight: 700;
  text-transform: uppercase;
  font-size: .8rem;
}

h1 {
  margin: 0;
  font-size: clamp(2.4rem, 7vw, 5rem);
  line-height: .95;
  letter-spacing: 0;
}

.pages {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  grid-column: 1 / -1;
}

.pages a {
  color: var(--brand);
  font-weight: 700;
  text-decoration: none;
}

.pages a:hover {
  text-decoration: underline;
}

.lede {
  max-width: 720px;
  color: var(--muted);
  font-size: 1.05rem;
  line-height: 1.6;
}

.panel {
  margin-top: 28px;
  padding: 22px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

h2 { margin: 0; }

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 18px 0;
}

button {
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fbfdf9;
  color: var(--ink);
  padding: 10px 12px;
  font-weight: 700;
  cursor: pointer;
}

button:hover {
  border-color: var(--brand);
  background: #f2faef;
}

.body-label {
  display: block;
  margin: 10px 0 8px;
  color: var(--muted);
  font-weight: 700;
}

textarea {
  width: 100%;
  margin-bottom: 12px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fbfdf9;
  color: var(--ink);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

button.active {
  border-color: var(--brand);
  background: #e8f7e2;
}

pre {
  min-height: 220px;
  margin: 0;
  padding: 16px;
  overflow: auto;
  border-radius: 8px;
  background: #102015;
  color: #dff3d8;
}

@media (max-width: 680px) {
  .hero { grid-template-columns: 1fr; }
}
`,

    tailwindInput: () => `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-[#f7faf6] text-[#172316];
  }
}
`,

    tailwindConfig: () => `module.exports = {
  content: ['./template/**/*.{html,js}'],
  theme: {
    extend: {}
  },
  plugins: []
};
`,

    templateApi: () => `window.EasyAPI = {
  async request(path, options = {}) {
    const response = await fetch(path, {
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      ...options,
      body: options.body && typeof options.body !== 'string'
        ? JSON.stringify(options.body)
        : options.body
    });

    const text = await response.text();
    const data = text ? parseResponse(text) : null;
    if (!response.ok) {
      const message = data?.error || data?.message || response.statusText;
      throw new Error(message);
    }
    return data;
  },
  get(path, options = {}) {
    return this.request(path, { ...options, method: 'GET' });
  },
  post(path, body, options = {}) {
    return this.request(path, { ...options, method: 'POST', body });
  },
  put(path, body, options = {}) {
    return this.request(path, { ...options, method: 'PUT', body });
  },
  patch(path, body, options = {}) {
    return this.request(path, { ...options, method: 'PATCH', body });
  },
  delete(path, options = {}) {
    return this.request(path, { ...options, method: 'DELETE' });
  }
};

function parseResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
`,

    templatePage: (title) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - easy.js</title>
  <link rel="stylesheet" href="/template/styles.css">
</head>
<body>
  <main class="shell">
    <header class="hero">
      <div class="mark" aria-hidden="true">E</div>
      <div>
        <p class="eyebrow">easy.js page</p>
        <h1>${title}</h1>
        <p class="lede">Build this page with plain HTML, CSS, and the EasyAPI helper.</p>
      </div>
    </header>

    <section class="panel">
      <div class="panel-head">
        <h2>${title}</h2>
        <a href="/">Home</a>
      </div>
      <pre id="page-output">Loading health status...</pre>
    </section>
  </main>
  <script src="/template/api.js"></script>
  <script>
    EasyAPI.get('/health')
      .then(data => {
        document.querySelector('#page-output').textContent = JSON.stringify(data, null, 2);
      })
      .catch(error => {
        document.querySelector('#page-output').textContent = error.message;
      });
  </script>
</body>
</html>
`,

    templateApp: () => `const output = document.querySelector('#output');
const routeList = document.querySelector('#route-list');
const bodyInput = document.querySelector('#request-body');
const send = document.querySelector('#send');
const copyCurl = document.querySelector('#copy-curl');
const refresh = document.querySelector('#refresh');
const usesBootstrap = Boolean(document.querySelector('link[href*="/vendor/bootstrap/"]'));

let selectedRoute = { method: 'GET', path: '/health' };

async function loadRoutes() {
  try {
    const data = await EasyAPI.get('/?format=json');
    const routes = [{ method: 'GET', path: '/health' }, ...(data.routes || [])];
    routeList.innerHTML = '';
    routes.forEach(route => {
      const button = document.createElement('button');
      button.textContent = \`\${route.method} \${route.path}\`;
      if (usesBootstrap) button.className = 'btn btn-success';
      button.dataset.method = route.method;
      button.dataset.endpoint = route.path.replace(/:[^/]+/g, '1');
      button.addEventListener('click', () => selectRoute(route.method, button.dataset.endpoint, button));
      routeList.appendChild(button);
    });
    const first = routeList.querySelector('button');
    if (first) first.click();
  } catch (error) {
    output.textContent = \`Could not load route list: \${error.message}\`;
  }
}

function selectRoute(method, endpoint, button) {
  selectedRoute = { method, path: endpoint };
  document.querySelectorAll('#route-list button').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  if (!['GET', 'HEAD', 'DELETE'].includes(method)) {
    bodyInput.value = JSON.stringify(sampleBodyFor(endpoint), null, 2);
  }
  output.textContent = \`Selected \${method} \${endpoint}\`;
}

function sampleBodyFor(endpoint) {
  if (endpoint.includes('/users')) {
    return {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'password123'
    };
  }
  if (endpoint.includes('/posts')) {
    return {
      title: 'Hello easy.js',
      content: 'This post was created from the starter UI.'
    };
  }
  return {
    name: 'Ada Lovelace',
    email: 'ada@example.com'
  };
}

async function callApi(route = selectedRoute) {
  output.textContent = \`Loading \${route.method} \${route.path}...\`;
  const options = { method: route.method };
  if (!['GET', 'HEAD'].includes(route.method)) {
    options.body = bodyInput.value;
  }
  try {
    const data = await EasyAPI.request(route.path, options);
    output.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  } catch (error) {
    output.textContent = error.message;
  }
}

function buildCurl(route = selectedRoute) {
  const parts = [\`curl -X \${route.method} "\${window.location.origin}\${route.path}"\`, '-H "Accept: application/json"'];
  if (!['GET', 'HEAD'].includes(route.method)) {
    parts.push('-H "Content-Type: application/json"');
    parts.push(\`-d '\${bodyInput.value.replace(/'/g, "'\\\\''")}'\`);
  }
  return parts.join(' \\\\\\n  ');
}

send.addEventListener('click', () => callApi());
copyCurl.addEventListener('click', async () => {
  const curl = buildCurl();
  try {
    await navigator.clipboard.writeText(curl);
    output.textContent = \`Copied curl command:\\n\\n\${curl}\`;
  } catch {
    output.textContent = curl;
  }
});
refresh.addEventListener('click', loadRoutes);
loadRoutes();
`,

    env: (projectName) => `NODE_ENV=development
PORT=3000
APP_NAME=${projectName}
JWT_SECRET=change-this-before-production
JWT_REFRESH_SECRET=change-this-refresh-secret
DATABASE_URL=mongodb://localhost:27017/${projectName}
MONGODB_URL=mongodb://localhost:27017/${projectName}
REDIS_URL=redis://localhost:6379
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=info
SENTRY_DSN=
FIELD_ENCRYPTION_KEY=change-this-field-key
`,

    envExample: () => `NODE_ENV=development
PORT=3000
APP_NAME=my-backend
JWT_SECRET=replace-me
JWT_REFRESH_SECRET=replace-me-too
DATABASE_URL=mongodb://localhost:27017/my-backend
MONGODB_URL=mongodb://localhost:27017/my-backend
REDIS_URL=redis://localhost:6379
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=info
SENTRY_DSN=
FIELD_ENCRYPTION_KEY=replace-me
`,

    gitignore: () => `node_modules
.env
logs
coverage
backups
dist
`,

    dockerfile: () => `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
`,

    dockerCompose: (projectName) => `services:
  api:
    build: .
    command: npm run dev
    ports:
      - "3000:3000"
    env_file:
      - .env
    depends_on:
      - mongo
      - redis

  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - ${projectName}_mongo:/data/db

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  ${projectName}_mongo:
`,

    ciWorkflow: () => `name: CI

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run doctor
      - run: npm test
`,

    packageJson: (projectName, uiPreset = 'plain') => {
      const ui = UI_PRESETS[uiPreset] || UI_PRESETS.plain;
      const dependencies = {
        'easybackend.js': `^${this.frameworkVersion()}`,
        mongoose: '^7.5.0'
      };
      for (const packageName of ui.packages) {
        dependencies[packageName] = this.packageVersionFor(packageName);
      }
      return ({
      name: projectName,
      version: '1.0.0',
      private: true,
      description: 'A secure backend built with easy.js',
      main: 'src/app.easy',
      scripts: {
        start: 'easyjs start src/app.easy',
        dev: 'easyjs dev src/app.easy',
        doctor: 'easyjs doctor',
        test: 'jest',
        'test:coverage': 'jest --coverage',
        'migrate:latest': 'knex migrate:latest',
        'migrate:rollback': 'knex migrate:rollback',
        'seed:run': 'knex seed:run'
      },
      dependencies,
      devDependencies: {
        jest: '^29.7.0',
        supertest: '^6.3.3',
        knex: '^2.5.1'
      }
    });
    },

    readme: (projectName) => `# ${projectName}

A secure backend built with easy.js.

## Start

\`\`\`bash
npm install
npm run doctor
npm run dev
\`\`\`

Open http://localhost:3000/ for the starter UI.

## What you get

- A working root UI with the easy.js logo
- Editable frontend files in the template folder
- Secure defaults
- JWT auth with refresh-token support
- Validation
- Health checks
- OpenAPI docs
- Admin-ready structure
- Tests
- Docker
- Migrations and seeds

## Add things

\`\`\`bash
easyjs add model Product
easyjs add route products
easyjs add database postgres
easyjs add auth jwt
easyjs add crud products
easyjs add job dailyReport
\`\`\`

## Provider Packages

easy.js installs only the core framework by default. When you select a provider, \`easyjs add database\` adds the matching package to \`package.json\`, and \`easyjs doctor\` tells you exactly what to install if anything is missing.
`
  };
}

if (require.main === module) {
  const cli = new CLI();
  cli.run();
}

module.exports = CLI;
