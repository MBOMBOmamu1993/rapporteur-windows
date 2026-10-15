// Rapporteur — le son des AUTRES applications pendant l'interprète vocal (Windows).
//
//   rapporteur-sons.exe lister
//   rapporteur-sons.exe baisser <fichier d'état> <niveau 0..1> <nom du processus à épargner>
//   rapporteur-sons.exe rendre  <fichier d'état>
//
// « baisser » met chaque session audio de la sortie par défaut (YouTube dans un
// navigateur, Teams, Zoom…) à <niveau> fois son volume, sauf celles de Rapporteur
// et les sons système, et note le volume d'avant dans le fichier d'état ; appelé
// de nouveau, il ne baisse que les sessions apparues depuis. « rendre » remet
// chaque volume noté et efface le fichier. Windows garde le volume des
// applications d'une fois sur l'autre : le fichier d'état permet de le rendre
// même après une fermeture brutale (main.js appelle « rendre » au démarrage).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace Rapporteur
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class EnumerateurCom { }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int flux, int etats, out IntPtr appareils);
        [PreserveSig] int GetDefaultAudioEndpoint(int flux, int role, out IMMDevice appareil);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int contexte, IntPtr parametres, [MarshalAs(UnmanagedType.IUnknown)] out object interfaceObtenue);
    }

    [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr a, int b, out IntPtr c);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    }

    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int nombre);
        [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
    }

    [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        [PreserveSig] int GetState(out int etat);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string nom);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string nom, ref Guid contexte);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string chemin);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string chemin, ref Guid contexte);
        [PreserveSig] int GetGroupingParam(out Guid groupe);
        [PreserveSig] int SetGroupingParam(ref Guid groupe, ref Guid contexte);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr avis);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr avis);
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint pid);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference(bool refuser);
    }

    [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float niveau, ref Guid contexte);
        [PreserveSig] int GetMasterVolume(out float niveau);
        [PreserveSig] int SetMute(bool muet, ref Guid contexte);
        [PreserveSig] int GetMute(out bool muet);
    }

    class Session
    {
        public string Id;
        public uint Pid;
        public string Processus;
        public ISimpleAudioVolume Volume;
    }

    static class Programme
    {
        static List<Session> Sessions()
        {
            var liste = new List<Session>();
            var enumerateur = (IMMDeviceEnumerator)new EnumerateurCom();
            // Rendu (0), rôles console (0) et communications (2) : souvent le même appareil.
            var vus = new HashSet<string>();
            foreach (int role in new[] { 0, 2 })
            {
                IMMDevice appareil;
                if (enumerateur.GetDefaultAudioEndpoint(0, role, out appareil) != 0 || appareil == null) continue;
                Guid iid = typeof(IAudioSessionManager2).GUID;
                object o;
                if (appareil.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) continue;
                IAudioSessionEnumerator sessions;
                if (((IAudioSessionManager2)o).GetSessionEnumerator(out sessions) != 0) continue;
                int nombre;
                sessions.GetCount(out nombre);
                for (int i = 0; i < nombre; i++)
                {
                    object s;
                    if (sessions.GetSession(i, out s) != 0 || s == null) continue;
                    var controle = (IAudioSessionControl2)s;
                    if (controle.IsSystemSoundsSession() == 0) continue;
                    string id;
                    if (controle.GetSessionInstanceIdentifier(out id) != 0 || id == null || !vus.Add(id)) continue;
                    uint pid;
                    controle.GetProcessId(out pid);
                    string nom = "";
                    try { nom = Process.GetProcessById((int)pid).ProcessName; } catch { nom = ""; }
                    liste.Add(new Session { Id = id, Pid = pid, Processus = nom, Volume = (ISimpleAudioVolume)s });
                }
            }
            return liste;
        }

        static Dictionary<string, float> LireEtat(string fichier)
        {
            var etat = new Dictionary<string, float>();
            if (!File.Exists(fichier)) return etat;
            foreach (var ligne in File.ReadAllLines(fichier, Encoding.UTF8))
            {
                int t = ligne.LastIndexOf('\t');
                float v;
                if (t > 0 && float.TryParse(ligne.Substring(t + 1), NumberStyles.Float, CultureInfo.InvariantCulture, out v))
                    etat[ligne.Substring(0, t)] = v;
            }
            return etat;
        }

        static void EcrireEtat(string fichier, Dictionary<string, float> etat)
        {
            var lignes = new List<string>();
            foreach (var e in etat) lignes.Add(e.Key + "\t" + e.Value.ToString("R", CultureInfo.InvariantCulture));
            File.WriteAllLines(fichier, lignes.ToArray(), new UTF8Encoding(false));
        }

        static int Main(string[] args)
        {
            string commande = args.Length > 0 ? args[0] : "lister";
            Guid contexte = Guid.Empty;
            try
            {
                if (commande == "lister")
                {
                    foreach (var s in Sessions())
                    {
                        float v; s.Volume.GetMasterVolume(out v);
                        Console.WriteLine(s.Pid + "\t" + s.Processus + "\t" + v.ToString("0.00", CultureInfo.InvariantCulture));
                    }
                    return 0;
                }
                if (args.Length < 2) { Console.Error.WriteLine("fichier d'état manquant"); return 2; }
                string fichier = args[1];
                if (commande == "baisser")
                {
                    float niveau = args.Length > 2 ? float.Parse(args[2], CultureInfo.InvariantCulture) : 0.15f;
                    string epargne = args.Length > 3 ? args[3] : "Rapporteur";
                    var etat = LireEtat(fichier);
                    int baissees = 0;
                    foreach (var s in Sessions())
                    {
                        if (etat.ContainsKey(s.Id)) continue;
                        if (string.Equals(s.Processus, epargne, StringComparison.OrdinalIgnoreCase)) continue;
                        float v;
                        if (s.Volume.GetMasterVolume(out v) != 0) continue;
                        etat[s.Id] = v;
                        s.Volume.SetMasterVolume(Math.Max(0f, Math.Min(1f, v * niveau)), ref contexte);
                        baissees++;
                    }
                    EcrireEtat(fichier, etat);
                    Console.WriteLine("baissées " + baissees);
                    return 0;
                }
                if (commande == "rendre")
                {
                    var etat = LireEtat(fichier);
                    int rendues = 0;
                    foreach (var s in Sessions())
                    {
                        float v;
                        if (!etat.TryGetValue(s.Id, out v)) continue;
                        s.Volume.SetMasterVolume(v, ref contexte);
                        rendues++;
                    }
                    if (File.Exists(fichier)) File.Delete(fichier);
                    Console.WriteLine("rendues " + rendues);
                    return 0;
                }
                Console.Error.WriteLine("commande inconnue : " + commande);
                return 2;
            }
            catch (Exception e)
            {
                Console.Error.WriteLine(e.Message);
                return 1;
            }
        }
    }
}
