using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// GG Email — нативное окно на WebView2 (движок Edge), без Electron и без
// вкладок браузера. Сервер поднимается на встроенном Node.js.
static class Program
{
    public const int Port = 4173;
    public const string Token = "gg-email-local";
    public const string Url = "http://127.0.0.1:4173/?token=gg-email-local";

    private static string _logPath = Path.Combine(Path.GetTempPath(), "gg-email-app.log");

    public static void Log(string message)
    {
        try
        {
            File.AppendAllText(_logPath,
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + Environment.NewLine);
        }
        catch
        {
            // логирование не критично
        }
    }

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            Prepare();
        }
        catch (Exception error)
        {
            Log("FATAL: " + error);
            MessageBox.Show(
                "GG Email не смог запуститься:\n" + error.Message + "\n\nЛог: " + _logPath,
                "GG Email", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static void Prepare()
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        Log("start baseDir=" + baseDir);

        string server = Path.Combine(baseDir, @"out\web\server.cjs");
        if (!File.Exists(server)) server = Path.Combine(baseDir, @"app\server.cjs");
        if (!File.Exists(server))
        {
            throw new FileNotFoundException(
                "Не найден out\\web\\server.cjs. Запускайте GG Email.exe из папки GG-Email-Web.");
        }

        string node = FindNode(baseDir);
        if (node == null) throw new FileNotFoundException("Не найден node.exe (ожидается node\\node.exe).");

        string profile = EnsureProfile(baseDir);
        if (profile == null) throw new UnauthorizedAccessException("Не удалось создать папку профиля.");
        _logPath = Path.Combine(profile, "launcher.log");
        Log("profile=" + profile + " node=" + node);
        MigrateProfile(baseDir, profile);

        if (!PortOpen())
        {
            StartServer(node, server, baseDir, profile);
        }
        if (!WaitPort(25000))
        {
            throw new Exception("Локальный сервер не запустился за 25 секунд. Проверьте, что порт 4173 свободен.");
        }

        if (Environment.GetEnvironmentVariable("GGEMAIL_SELFTEST") == "1")
        {
            Log("selftest: server ready");
            return;
        }

        Application.Run(new MainForm(profile));
    }

    private static string EnsureProfile(string baseDir)
    {
        string[] candidates =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GG Email Web"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GG Email Web"),
            Path.Combine(Path.GetTempPath(), "GG Email Web"),
            Path.Combine(baseDir, ".profile")
        };
        foreach (string candidate in candidates)
        {
            try
            {
                Directory.CreateDirectory(candidate);
                string probe = Path.Combine(candidate, "write-test.tmp");
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
                return candidate;
            }
            catch (Exception error)
            {
                Log("profile candidate failed: " + candidate + " — " + error.Message);
            }
        }
        return null;
    }

    private static string FindNode(string baseDir)
    {
        string bundled = Path.Combine(baseDir, @"node\node.exe");
        if (File.Exists(bundled)) return bundled;

        string[] candidates =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"nodejs\node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"nodejs\node.exe")
        };
        foreach (string candidate in candidates)
        {
            if (File.Exists(candidate)) return candidate;
        }
        string path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (string part in path.Split(';'))
        {
            try
            {
                string candidate = Path.Combine(part.Trim(), "node.exe");
                if (File.Exists(candidate)) return candidate;
            }
            catch
            {
            }
        }
        return null;
    }

    private static void StartServer(string node, string server, string baseDir, string profile)
    {
        var info = new ProcessStartInfo(node, "\"" + server + "\"");
        info.WorkingDirectory = baseDir;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.WindowStyle = ProcessWindowStyle.Hidden;
        info.EnvironmentVariables["GGEMAIL_PORT"] = Port.ToString();
        info.EnvironmentVariables["GGEMAIL_TOKEN"] = Token;
        info.EnvironmentVariables["GGEMAIL_USER_DATA"] = profile;
        Process process = Process.Start(info);
        Log("node started pid=" + (process == null ? "null" : process.Id.ToString()));
    }

    private static bool PortOpen()
    {
        try
        {
            using (var client = new TcpClient())
            {
                IAsyncResult task = client.BeginConnect("127.0.0.1", Port, null, null);
                return task.AsyncWaitHandle.WaitOne(400) && client.Connected;
            }
        }
        catch
        {
            return false;
        }
    }

    private static bool WaitPort(int milliseconds)
    {
        int waited = 0;
        while (waited < milliseconds)
        {
            if (PortOpen()) return true;
            Thread.Sleep(300);
            waited += 300;
        }
        return false;
    }

    private static void MigrateProfile(string baseDir, string profile)
    {
        try
        {
            string source = Path.Combine(baseDir, ".webdata");
            if (!Directory.Exists(source)) return;
            if (File.Exists(Path.Combine(profile, "gg-email.db"))) return;
            foreach (string name in new[] { "gg-email.db", "gg-email.db-wal", "gg-email.db-shm", "secrets.bin", "web-secret.key" })
            {
                string from = Path.Combine(source, name);
                if (File.Exists(from)) File.Copy(from, Path.Combine(profile, name), true);
            }
        }
        catch (Exception error)
        {
            Log("migration failed: " + error.Message);
        }
    }
}

internal sealed class MainForm : Form
{
    private readonly string _profile;
    private readonly WebView2 _view;

    public MainForm(string profile)
    {
        _profile = profile;
        Text = "GG Email";
        Width = 1400;
        Height = 900;
        MinimumSize = new Size(900, 600);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.White;
        _view = new WebView2 { Dock = DockStyle.Fill };
        Controls.Add(_view);
        Load += OnLoad;
    }

    private async void OnLoad(object sender, EventArgs e)
    {
        try
        {
            string dataFolder = Path.Combine(_profile, "webview2");
            Directory.CreateDirectory(dataFolder);
            CoreWebView2Environment environment =
                await CoreWebView2Environment.CreateAsync(null, dataFolder);
            await _view.EnsureCoreWebView2Async(environment);
            _view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            _view.CoreWebView2.Settings.IsStatusBarEnabled = false;
            _view.CoreWebView2.NewWindowRequested += (s, args) =>
            {
                args.Handled = true;
                try
                {
                    Process.Start(args.Uri);
                }
                catch
                {
                    // внешние ссылки не критичны
                }
            };
            _view.Source = new Uri(Program.Url);
            Program.Log("webview2 ready");
        }
        catch (Exception error)
        {
            Program.Log("webview2 failed: " + error);
            MessageBox.Show(
                "Не удалось инициализировать WebView2.\n\n" + error.Message +
                "\n\nОткрою клиент в браузере. Для отдельного окна установите WebView2 Runtime от Microsoft.",
                "GG Email", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            try
            {
                Process.Start(Program.Url);
            }
            catch
            {
            }
            Close();
        }
    }
}
