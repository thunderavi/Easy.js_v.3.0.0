const fs = require('fs');
const path = require('path');
const CLI = require('../../cli/index');
const rootPackage = require('../../package.json');

describe('CLI defaults', () => {
  it('falls back to bundled quickstart when no project src/app.easy exists', () => {
    const cli = new CLI(['node', 'cli/index.js', 'typecheck']);

    expect(fs.existsSync(path.resolve(process.cwd(), 'src/app.easy'))).toBe(false);
    expect(cli.defaultEasyFile()).toBe('examples/quickstart.easy');
  });

  it('detects missing provider packages from easy files', () => {
    const cwd = process.cwd();
    const temp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'easy-cli-'));
    try {
      process.chdir(temp);
      fs.mkdirSync('src');
      fs.writeFileSync('src/app.easy', 'START SERVER 3000\nUSE SUPABASE SUPABASE_URL\n');
      fs.writeFileSync('package.json', JSON.stringify({ dependencies: { 'easybackend.js': '^3.1.0' } }));

      const cli = new CLI(['node', 'cli/index.js', 'doctor']);
      const checks = cli.checkProviderDependencies('src/app.easy');

      expect(checks).toEqual([
        expect.objectContaining({
          ok: false,
          message: 'You use Supabase but @supabase/supabase-js is missing. Run npm install @supabase/supabase-js.'
        })
      ]);
    } finally {
      process.chdir(cwd);
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it('adds database provider dependencies to generated projects', () => {
    const cwd = process.cwd();
    const temp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'easy-cli-'));
    try {
      process.chdir(temp);
      fs.mkdirSync('src');
      fs.writeFileSync('src/app.easy', 'START SERVER 3000\nUSE MONGODB mongodb://localhost:27017/app\n');
      fs.writeFileSync('package.json', JSON.stringify({ dependencies: { 'easybackend.js': '^3.1.0' } }, null, 2));

      const cli = new CLI(['node', 'cli/index.js', 'add', 'database', 'postgres']);
      cli.addDatabase('postgres');

      expect(fs.readFileSync('src/app.easy', 'utf8')).toContain('USE POSTGRES postgres://postgres:postgres@localhost:5432/app');
      expect(JSON.parse(fs.readFileSync('package.json', 'utf8')).dependencies.pg).toBe('^8.11.2');
    } finally {
      process.chdir(cwd);
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it('creates an editable template UI folder for new projects', () => {
    const cwd = process.cwd();
    const temp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'easy-cli-'));
    try {
      process.chdir(temp);
      const cli = new CLI(['node', 'cli/index.js', 'create', 'ui-api']);
      cli.createProject();

      expect(fs.existsSync(path.join(temp, 'ui-api', 'template', 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(temp, 'ui-api', 'template', 'styles.css'))).toBe(true);
      expect(fs.existsSync(path.join(temp, 'ui-api', 'template', 'api.js'))).toBe(true);
      expect(fs.existsSync(path.join(temp, 'ui-api', 'template', 'app.js'))).toBe(true);
      expect(fs.readFileSync(path.join(temp, 'ui-api', 'template', 'index.html'), 'utf8')).toContain('route-list');
      expect(fs.readFileSync(path.join(temp, 'ui-api', 'template', 'api.js'), 'utf8')).toContain('window.EasyAPI');
      expect(fs.readFileSync(path.join(temp, 'ui-api', 'template', 'app.js'), 'utf8')).toContain('copyCurl');
      expect(fs.readFileSync(path.join(temp, 'ui-api', 'template', 'app.js'), 'utf8')).toContain('password123');
      expect(fs.readFileSync(path.join(temp, 'ui-api', 'README.md'), 'utf8')).toContain('template folder');
      expect(JSON.parse(fs.readFileSync(path.join(temp, 'ui-api', 'package.json'), 'utf8')).dependencies['easybackend.js']).toBe(`^${rootPackage.version}`);
    } finally {
      process.chdir(cwd);
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it('creates Bootstrap and Tailwind UI presets', () => {
    const cwd = process.cwd();
    const temp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'easy-cli-'));
    try {
      process.chdir(temp);
      new CLI(['node', 'cli/index.js', 'create', 'boot-api', '--ui', 'bootstrap']).createProject();
      const bootPkg = JSON.parse(fs.readFileSync(path.join(temp, 'boot-api', 'package.json'), 'utf8'));
      expect(bootPkg.dependencies.bootstrap).toBe('^5.3.3');
      expect(fs.readFileSync(path.join(temp, 'boot-api', 'template', 'index.html'), 'utf8')).toContain('/vendor/bootstrap/css/bootstrap.min.css');

      process.chdir(temp);
      new CLI(['node', 'cli/index.js', 'create', 'tw-api', '--ui=tailwind']).createProject();
      const tailwindPkg = JSON.parse(fs.readFileSync(path.join(temp, 'tw-api', 'package.json'), 'utf8'));
      expect(tailwindPkg.dependencies.tailwindcss).toBe('^3.4.17');
      expect(fs.existsSync(path.join(temp, 'tw-api', 'tailwind.config.js'))).toBe(true);
      expect(fs.existsSync(path.join(temp, 'tw-api', 'template', 'input.css'))).toBe(true);
    } finally {
      process.chdir(cwd);
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it('adds UI presets to existing projects', () => {
    const cwd = process.cwd();
    const temp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'easy-cli-'));
    try {
      process.chdir(temp);
      fs.writeFileSync('package.json', JSON.stringify({ name: 'existing', dependencies: { 'easybackend.js': '^3.2.0' } }, null, 2));

      const cli = new CLI(['node', 'cli/index.js', 'add', 'ui', 'tailwind']);
      cli.addUiPreset('tailwind');

      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      expect(pkg.dependencies.tailwindcss).toBe('^3.4.17');
      expect(pkg.scripts['ui:build']).toContain('tailwindcss');
      expect(fs.existsSync('template/index.html')).toBe(true);
      expect(fs.existsSync('template/api.js')).toBe(true);
    } finally {
      process.chdir(cwd);
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it('adds template pages and links them from the starter UI', () => {
    const cwd = process.cwd();
    const temp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'easy-cli-'));
    try {
      process.chdir(temp);
      const cli = new CLI(['node', 'cli/index.js', 'create', 'pages-api']);
      cli.createProject();
      process.chdir(path.join(temp, 'pages-api'));

      const projectCli = new CLI(['node', 'cli/index.js', 'add', 'page', 'admin dashboard']);
      projectCli.addTemplatePage('admin dashboard');

      expect(fs.existsSync('template/pages/admin-dashboard.html')).toBe(true);
      expect(fs.readFileSync('template/pages/admin-dashboard.html', 'utf8')).toContain('EasyAPI.get');
      expect(fs.readFileSync('template/index.html', 'utf8')).toContain('/template/pages/admin-dashboard.html');
    } finally {
      process.chdir(cwd);
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it('handles seed command arguments correctly', () => {
    const cli = new CLI(['node', 'cli/index.js', 'seed']);
    const shellSpy = jest.spyOn(cli, 'runShell').mockImplementation(() => {});

    // No arguments -> run all
    cli.runSeedCommand();
    expect(shellSpy).toHaveBeenLastCalledWith('npm run seed:run');

    // 'run' -> run all
    cli.args = ['run'];
    cli.runSeedCommand();
    expect(shellSpy).toHaveBeenLastCalledWith('npm run seed:run');

    // 'make' 'users' -> make seed
    cli.args = ['make', 'users'];
    cli.runSeedCommand();
    expect(shellSpy).toHaveBeenLastCalledWith('npm run seed:create -- users');

    // specific seed name where file exists
    const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readdirSpy = jest.spyOn(fs, 'readdirSync').mockReturnValue(['seed_users.js', '001_posts.js']);
    
    cli.args = ['users'];
    cli.runSeedCommand();
    expect(shellSpy).toHaveBeenLastCalledWith('npx knex seed:run --specific=seed_users.js');

    cli.args = ['posts'];
    cli.runSeedCommand();
    expect(shellSpy).toHaveBeenLastCalledWith('npx knex seed:run --specific=001_posts.js');

    // fallback if no matching file exists
    readdirSpy.mockReturnValue([]);
    cli.args = ['missing'];
    cli.runSeedCommand();
    expect(shellSpy).toHaveBeenLastCalledWith('npm run seed:run');

    existsSpy.mockRestore();
    readdirSpy.mockRestore();
    shellSpy.mockRestore();
  });
});
