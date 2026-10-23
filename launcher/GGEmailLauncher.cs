using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

// GG Email — лёгкий лаунчер веб-версии: поднимает локальный сервер и
// открывает клиент в отдельном окне Edge (режим --app). Не требует Electron.
static class Program
{
    private const int Port = 4173;
    private const string Token = "gg-email-local";
    private const string Url = "http://127.0.0.1:4173/?token=gg-email-local";

    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        @"GG Email Web\launcher.log");

    private static void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
            File.AppendAllText(LogPath,
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
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        Log("start baseDir=" + baseDir);

        string server = Path.Combine(baseDir, @"out\web\server.cjs");
        if (!File.Exists(server)) server = Path.Combine(baseDir, @"app\server.cjs");
        Log("server=" + server + " exists=" + File.Exists(server));
        if (!File.Exists(server))
        {
            Log("server not found");
            MessageBox.Show(
                "Не найден файл сервера (out\\web\\server.cjs).\nСоберите проект: npm install && npm run build:web",
                "GG Email", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        string node = FindNode(baseDir);
        Log("node=" + (node ?? "null"));
        if (node == null)
        {
            MessageBox.Show(
                "Не найден Node.js 22+.\nУстановите Node.js или используйте установщик GG Email.",
                "GG Email", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        string profile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "GG Email Web");
        Directory.CreateDirectory(profile);
        MigrateProfile(baseDir, profile);

        if (!PortOpen())
        {
            Log("starting server, profile=" + profile);
            StartServer(node, server, baseDir, profile);
        }
        else
        {
            Log("server already running");
        }

        bool ready = WaitPort(25000);
        Log("port ready=" + ready);
        if (!ready)
        {
            MessageBox.Show(
                "Локальный сервер GG Email не запустился за 25 секунд.\nПроверьте, что порт 4173 свободен, и запустите ещё раз.",
                "GG Email", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        if (Environment.GetEnvironmentVariable("GGEMAIL_LAUNCHER_TEST") == "1")
        {
            Log("test mode, window skipped");
            return;
        }

        Log("opening window");
        OpenWindow();
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
                // некорректная запись в PATH — пропускаем
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

    private static void OpenWindow()
    {
        string[] edges =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe")
        };
        foreach (string edge in edges)
        {
            if (!File.Exists(edge)) continue;
            try
            {
                Process.Start(edge, "--app=" + Url + " --window-size=1400,900");
                Log("edge started: " + edge);
                return;
            }
            catch (Exception error)
            {
                Log("edge failed: " + error.Message);
            }
        }
        try
        {
            Process.Start(Url);
            Log("default browser started");
        }
        catch (Exception error)
        {
            Log("browser failed: " + error.Message);
            MessageBox.Show("Не удалось открыть окно: " + error.Message, "GG Email",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    /// <summary>Переносит профиль из папки проекта (.webdata), если он есть.</summary>
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
            Log("profile migrated from .webdata");
        }
        catch (Exception error)
        {
            Log("migration failed: " + error.Message);
        }
    }
}
