import { useEffect, useRef, useState } from "react";
import { User, Bell, Shield, Palette, Globe, Save, Camera, TrendingUp, RefreshCw, Users, Plus, Trash2, Radio, PencilLine, KeyRound, Clock, CheckCircle2, Lock, History, FileEdit, FileX, FilePlus, Activity, XCircle, AlertCircle, Database, Cloud, HardDrive, UserCheck, MessageCircle, Instagram } from "lucide-react";
import { loadIghAdminSettings, saveIghAdminSettings, formatWhatsappDisplay, type IghAdminSettings } from "@/lib/ighSettings";
import { supabase, isSupabaseConfigured, SUPABASE_URL } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  applyAppearanceSettings,
  loadAppearanceSettings,
  saveAppearanceSettings,
  type AppearanceFontSize,
  type AppearanceSettings,
  type AppearanceTheme,
} from "@/lib/appearance";
import { useRatesStore } from "@/store/ratesStore";
import { listRecentAuditLogs, describeChange, type AuditLog } from "@/features/audit/auditRepo";
import { useAuthStore, type LoginEvent, type MemberInfo } from "@/store/authStore";
import { migrateBase64ToStorage, type MigrateProgress } from "@/lib/migrateBase64ToStorage";
import { useRegionalStore } from "@/store/regionalStore";
import { useT } from "@/lib/regional";

async function resizeImageToDataUrl(file: File, maxSize = 320, quality = 0.85): Promise<string> {
  const blobUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Gagal memuat gambar."));
      el.src = blobUrl;
    });
    const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas tidak didukung.");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-[13px] md:text-[14px] font-bold text-[hsl(var(--foreground))]">{title}</h2>
      <p className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">{desc}</p>
    </div>
  );
}

function ToggleRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-xl border border-[hsl(var(--border))] bg-white gap-3">
      <div className="min-w-0">
        <p className="text-[12px] md:text-[12.5px] font-medium text-[hsl(var(--foreground))] leading-tight">{label}</p>
        <p className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5 leading-tight">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="shrink-0" />
    </div>
  );
}

export default function Settings() {
  const t = useT();
  const [tab, setTab] = useState("profile");

  const TABS = [
    { key: "profile",       label: t.settings_profile,       icon: User },
    { key: "notifications", label: t.settings_notifications, icon: Bell },
    { key: "security",      label: t.settings_security,      icon: Shield },
    { key: "appearance",    label: t.settings_appearance,    icon: Palette },
    { key: "regional",      label: t.settings_regional,      icon: Globe },
    { key: "rates",         label: t.settings_rates,         icon: TrendingUp },
    { key: "agents",        label: t.settings_agents,        icon: Users },
    { key: "audit",         label: "Audit Log",              icon: History },
    { key: "status",        label: "Status",                 icon: Activity },
  ];

  const [profile, setProfile] = useState({
    name: "",
    email: "",
    phone: "",
    agency: "",
    address: "",
    bio: "",
  });

  const [notif, setNotif] = useState({
    tripReminder: true,
    newMessage: true,
    paymentAlert: true,
    weeklyReport: false,
    marketing: false,
  });

  const [security, setSecurity] = useState({
    currentPw: "",
    newPw: "",
    confirmPw: "",
    twoFactor: false,
    loginAlert: true,
  });

  const [appearance, setAppearance] = useState<AppearanceSettings>(() => loadAppearanceSettings());

  // IGH Settings — kontak admin yang muncul di footer PDF penawaran & Dashboard.
  const [ighAdmin, setIghAdmin] = useState<IghAdminSettings>(() => loadIghAdminSettings());
  const [savingIghAdmin, setSavingIghAdmin] = useState(false);
  const handleSaveIghAdmin = () => {
    setSavingIghAdmin(true);
    try {
      const next = saveIghAdminSettings({
        adminWhatsapp: ighAdmin.adminWhatsapp.trim(),
        adminInstagram: ighAdmin.adminInstagram.replace(/^@+/, "").trim(),
      });
      setIghAdmin(next);
      toast.success("Kontak admin disimpan. Akan muncul di footer PDF penawaran berikutnya.");
    } catch (e: any) {
      toast.error(`Gagal menyimpan: ${e?.message ?? e}`);
    } finally {
      setSavingIghAdmin(false);
    }
  };

  const {
    rates,
    rawRates,
    manualRates,
    mode: rateMode,
    lastUpdated,
    loading: ratesLoading,
    markupPct,
    setMarkup,
    setMode: setRateMode,
    setManualRate,
    refresh: refreshRates,
  } = useRatesStore();

  const {
    user,
    inviteMember,
    removeMember,
    listMembers,
    changePassword,
    getSecuritySettings,
    updateSecuritySettings,
    setupPin,
    getLoginHistory,
  } = useAuthStore();

  const isOwner = user?.role === "owner";
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberPass, setNewMemberPass] = useState("");
  const [invitingMember, setInvitingMember] = useState(false);

  const [migrating, setMigrating] = useState(false);
  const [migrateProgress, setMigrateProgress] = useState<MigrateProgress | null>(null);

  const photoKey = user ? `igh.profile.photo.${user.id}` : null;
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!photoKey) { setProfilePhoto(null); return; }
    try { setProfilePhoto(localStorage.getItem(photoKey)); } catch { setProfilePhoto(null); }
  }, [photoKey]);

  const handlePhotoFile = async (file: File) => {
    if (!photoKey) { toast.error("Belum login."); return; }
    if (!file.type.startsWith("image/")) { toast.error("File harus gambar."); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error("Ukuran maks 8 MB."); return; }
    setPhotoUploading(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file, 320, 0.85);
      localStorage.setItem(photoKey, dataUrl);
      setProfilePhoto(dataUrl);
      toast.success("Foto profil diperbarui.");
    } catch (e: any) {
      toast.error(`Gagal memproses foto: ${e?.message ?? e}`);
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleRemovePhoto = () => {
    if (!photoKey) return;
    localStorage.removeItem(photoKey);
    setProfilePhoto(null);
    toast.success("Foto profil dihapus.");
  };

  const [loginHistory, setLoginHistory] = useState<LoginEvent[]>([]);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinLoading, setPinLoading] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (tab === "agents") {
      listMembers().then(setMembers).catch((e) => toast.error(`Gagal load member: ${e.message}`));
    }
  }, [tab, listMembers]);

  useEffect(() => {
    if (tab === "security") {
      const sec = getSecuritySettings();
      setSecurity((s) => ({ ...s, twoFactor: sec.twoFactor, loginAlert: sec.loginAlert }));
      setLoginHistory(getLoginHistory());
    }
  }, [tab]);

  const handleInviteMember = async () => {
    if (!newMemberEmail || !newMemberName || !newMemberPass) {
      toast.error("Lengkapi semua field."); return;
    }
    if (newMemberPass.length < 8) {
      toast.error("Password minimal 8 karakter."); return;
    }
    setInvitingMember(true);
    // Capture form values dulu — biar kalau user buru-buru ngosongin field
    // setelah submit, optimistic row tetep punya nama yg dia masukin.
    const emailIn = newMemberEmail.trim();
    const nameIn = newMemberName.trim();
    try {
      await inviteMember(emailIn, newMemberPass, nameIn);

      // ── Instant feedback ──
      // Tambah row baru ke list secara optimistic — pake placeholder userId
      // sementara nunggu listMembers() yg authoritative selesai. User langsung
      // liat namanya muncul tanpa flicker / refresh manual.
      const optimisticRow: MemberInfo = {
        userId: `pending-${Date.now()}`,
        email: emailIn,
        displayName: nameIn,
        role: "staff",
        createdAt: new Date().toISOString(),
      };
      setMembers((prev) => [...prev, optimisticRow]);

      // Re-sync dgn server (replace optimistic row dgn data asli yg join ke
      // profiles). Kalau gagal, optimistic row tetep ada — owner bisa refresh
      // manual. Berhubung edge function juga upsert ke profiles, list ini bakal
      // include nama beneran.
      try {
        const fresh = await listMembers();
        setMembers(fresh);
      } catch { /* ignore — optimistic row stays */ }

      setNewMemberEmail(""); setNewMemberName(""); setNewMemberPass("");
      toast.success(`"${nameIn}" diundang. Beri tahu password awalnya secara aman.`);
    } catch (e: any) {
      toast.error(`Undang gagal: ${e?.message ?? "unknown error"}`);
    } finally {
      // PASTIKAN selalu reset, walaupun ada exception/halt di tengah jalan.
      setInvitingMember(false);
    }
  };

  const handleRemoveMember = async (userId: string, displayName: string) => {
    if (!confirm(`Hapus member "${displayName}"? Akun & akses dicabut permanen.`)) return;
    try {
      await removeMember(userId);
      try { setMembers(await listMembers()); } catch { /* ignore — owner bisa refresh manual */ }
      toast.success("Member dihapus.");
    } catch (e: any) {
      toast.error(`Hapus gagal: ${e?.message ?? "unknown error"}`);
    }
  };

  const handleMigrate = async () => {
    if (!confirm("Migrasi semua foto/dokumen base64 di DB ke Supabase Storage. Lanjut?")) return;
    setMigrating(true);
    setMigrateProgress({ phase: "photos", total: 0, done: 0, failed: 0 });
    try {
      const res = await migrateBase64ToStorage((p) => setMigrateProgress(p));
      const total = res.photosMigrated + res.docsMigrated;
      const failed = res.photosFailed + res.docsFailed;
      if (failed > 0) {
        toast.warning(`Migrasi selesai: ${total} berhasil, ${failed} gagal.`, {
          description: res.errors.slice(0, 3).join("\n"),
        });
      } else {
        toast.success(`Migrasi selesai: ${total} item dipindahkan ke Storage.`);
      }
    } catch (e: any) {
      toast.error(`Migrasi gagal: ${e.message}`);
    } finally {
      setMigrating(false);
      setMigrateProgress(null);
    }
  };

  const { language, timezone, currency, dateFormat, setRegional } = useRegionalStore();
  const regional = { language, timezone, currency, dateFormat };

  useEffect(() => {
    applyAppearanceSettings(appearance);
    saveAppearanceSettings(appearance);
  }, [appearance]);

  const handleSave = () => {
    applyAppearanceSettings(appearance);
    saveAppearanceSettings(appearance);
    toast.success("Pengaturan berhasil disimpan!");
  };

  const handleChangePassword = async () => {
    if (!security.currentPw) { toast.error("Masukkan kata sandi saat ini."); return; }
    if (!security.newPw) { toast.error("Masukkan kata sandi baru."); return; }
    if (security.newPw !== security.confirmPw) { toast.error("Konfirmasi kata sandi tidak cocok."); return; }
    setSavingPassword(true);
    try {
      await changePassword(security.currentPw, security.newPw);
      setSecurity((s) => ({ ...s, currentPw: "", newPw: "", confirmPw: "" }));
      toast.success("Kata sandi berhasil diubah.");
    } catch (e: any) {
      toast.error(e.message);
    }
    setSavingPassword(false);
  };

  const handleToggle2FA = (enabled: boolean) => {
    if (enabled) {
      setPinInput(""); setPinConfirm("");
      setPinDialogOpen(true);
    } else {
      updateSecuritySettings({ twoFactor: false, pinHash: undefined });
      setSecurity((s) => ({ ...s, twoFactor: false }));
      toast.success("Autentikasi 2FA dinonaktifkan.");
    }
  };

  const handleSavePin = async () => {
    if (pinInput.length < 4) { toast.error("PIN minimal 4 digit."); return; }
    if (pinInput !== pinConfirm) { toast.error("Konfirmasi PIN tidak cocok."); return; }
    setPinLoading(true);
    try {
      await setupPin(pinInput);
      updateSecuritySettings({ twoFactor: true });
      setSecurity((s) => ({ ...s, twoFactor: true }));
      setPinDialogOpen(false);
      setPinInput(""); setPinConfirm("");
      toast.success("Autentikasi 2FA diaktifkan.", { description: "PIN keamanan berhasil disimpan." });
    } catch {
      toast.error("Gagal menyimpan PIN. Coba lagi.");
    }
    setPinLoading(false);
  };

  const handleToggleLoginAlert = (enabled: boolean) => {
    updateSecuritySettings({ loginAlert: enabled });
    setSecurity((s) => ({ ...s, loginAlert: enabled }));
    toast.success(enabled ? "Notifikasi login diaktifkan." : "Notifikasi login dinonaktifkan.");
  };

  return (
    <div className="flex flex-col md:flex-row gap-3 md:gap-6">

      {/* ── Tab nav: horizontal scroll on mobile, vertical sidebar on desktop ── */}
      <div className="md:w-44 md:shrink-0 -mx-3 md:mx-0 px-3 md:px-0 sticky top-0 z-10 bg-[hsl(var(--card))] py-1 md:py-0 md:static md:bg-transparent">
        {/* Mobile: horizontal pill tabs */}
        <div className="flex md:hidden gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-semibold whitespace-nowrap shrink-0 transition-all border",
                tab === t.key
                  ? "bg-[hsl(var(--primary))] text-white border-[hsl(var(--primary))]"
                  : "bg-white text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]"
              )}
            >
              <t.icon strokeWidth={1.5} className="h-3 w-3" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Desktop: vertical nav */}
        <nav className="hidden md:block space-y-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all",
                tab === t.key
                  ? "bg-[hsl(var(--accent))] text-[hsl(var(--primary))]"
                  : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]"
              )}
            >
              <t.icon strokeWidth={1.5} className="h-4 w-4 shrink-0" />
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 min-w-0">

        {tab === "profile" && (
          <div className="space-y-4 max-w-xl">
            <SectionHeader title="Profil Agen" desc="Kelola informasi akun dan profil Anda" />

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="relative group cursor-pointer shrink-0"
                title="Klik untuk ubah foto"
                aria-label="Ubah foto profil"
              >
                <div
                  className={cn(
                    "h-12 w-12 rounded-xl shadow-glow overflow-hidden flex items-center justify-center text-white text-base font-bold",
                    profilePhoto ? "bg-[hsl(var(--secondary))]" : "gradient-primary"
                  )}
                >
                  {profilePhoto ? (
                    <img src={profilePhoto} alt="Foto profil" className="h-full w-full object-cover" />
                  ) : profile.name ? (
                    profile.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
                  ) : (
                    "?"
                  )}
                </div>
                <div className="absolute inset-0 rounded-xl bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera strokeWidth={1.5} className="h-4 w-4 text-white" />
                </div>
                {photoUploading && (
                  <div className="absolute inset-0 rounded-xl bg-black/60 flex items-center justify-center">
                    <RefreshCw strokeWidth={2} className="h-4 w-4 text-white animate-spin" />
                  </div>
                )}
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handlePhotoFile(f);
                  e.target.value = "";
                }}
              />
              <div>
                <p className="text-[13px] font-semibold text-[hsl(var(--foreground))]">{profile.name || <span className="text-[hsl(var(--muted-foreground))] font-normal italic">Belum diisi</span>}</p>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{profile.email || "—"}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={photoUploading}
                    className="text-[11px] text-[hsl(var(--primary))] font-medium hover:underline disabled:opacity-50"
                  >
                    {photoUploading ? "Mengunggah…" : profilePhoto ? "Ubah foto" : "Unggah foto"}
                  </button>
                  {profilePhoto && !photoUploading && (
                    <>
                      <span className="text-[11px] text-[hsl(var(--muted-foreground))]">·</span>
                      <button
                        type="button"
                        onClick={handleRemovePhoto}
                        className="text-[11px] text-red-500 font-medium hover:underline"
                      >
                        Hapus
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))]">Nama Lengkap</Label>
                <Input className="h-8 md:h-9 text-[13px] md:text-sm" placeholder="cth: Ahmad Fauzi" value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))]">Email</Label>
                <Input className="h-8 md:h-9 text-[13px] md:text-sm" type="email" placeholder="cth: agen@ightour.id" value={profile.email} onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))]">No. Telepon</Label>
                <Input className="h-8 md:h-9 text-[13px] md:text-sm" placeholder="cth: 0812-3456-7890" value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))]">Nama Agen</Label>
                <Input className="h-8 md:h-9 text-[13px] md:text-sm" placeholder="cth: IGH Tour & Travel" value={profile.agency} onChange={(e) => setProfile((p) => ({ ...p, agency: e.target.value }))} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))]">Alamat Kantor</Label>
                <Input className="h-8 md:h-9 text-[13px] md:text-sm" placeholder="cth: Jl. Sudirman No. 1, Jakarta" value={profile.address} onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))]">Bio Singkat</Label>
                <textarea
                  rows={2}
                  value={profile.bio}
                  placeholder="Ceritakan sedikit tentang agen travel Anda…"
                  onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))}
                  className="w-full rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-[13px] md:text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                />
              </div>
            </div>

            {/* ── IGH Settings: Kontak Admin (muncul di footer PDF penawaran) ── */}
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 space-y-3 mt-2">
              <div className="flex items-start gap-2">
                <div className="h-7 w-7 rounded-lg bg-orange-100 flex items-center justify-center shrink-0 mt-0.5">
                  <MessageCircle className="h-3.5 w-3.5 text-orange-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[hsl(var(--foreground))]">Kontak Admin (Footer Penawaran)</p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5 leading-snug">
                    Akan muncul di footer PDF penawaran sejajar dengan Instagram, dan ditampilkan di Dashboard untuk admin internal.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <Label className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))] flex items-center gap-1">
                    <MessageCircle className="h-3 w-3 text-emerald-500" /> WhatsApp Admin
                  </Label>
                  <Input
                    className="h-8 md:h-9 text-[13px] md:text-sm"
                    placeholder="cth: +6282245193615"
                    value={ighAdmin.adminWhatsapp}
                    onChange={(e) => setIghAdmin((s) => ({ ...s, adminWhatsapp: e.target.value }))}
                  />
                  {ighAdmin.adminWhatsapp.replace(/\D/g, "").length >= 8 && (
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                      Tampil di PDF: <span className="font-medium text-[hsl(var(--foreground))]">{formatWhatsappDisplay(ighAdmin.adminWhatsapp)}</span>
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))] flex items-center gap-1">
                    <Instagram className="h-3 w-3 text-pink-500" /> Instagram Handle
                  </Label>
                  <Input
                    className="h-8 md:h-9 text-[13px] md:text-sm"
                    placeholder="cth: igh.tour"
                    value={ighAdmin.adminInstagram}
                    onChange={(e) => setIghAdmin((s) => ({ ...s, adminInstagram: e.target.value }))}
                  />
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                    Sudah pre-printed di template; field ini untuk referensi.
                  </p>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={handleSaveIghAdmin}
                  disabled={savingIghAdmin}
                  className="h-8 px-4 rounded-xl text-xs gradient-primary text-white"
                >
                  <Save className="h-3 w-3 mr-1" />
                  {savingIghAdmin ? "Menyimpan…" : "Simpan Kontak Admin"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {tab === "notifications" && (
          <div className="space-y-2 max-w-xl">
            <SectionHeader title="Notifikasi" desc="Atur kapan dan bagaimana Anda menerima notifikasi" />
            {[
              { key: "tripReminder" as const, label: "Pengingat Trip",          desc: "Notifikasi H-7 dan H-1 sebelum keberangkatan" },
              { key: "newMessage"   as const, label: "Pesan Baru",              desc: "Notifikasi saat ada pesan masuk dari jamaah" },
              { key: "paymentAlert" as const, label: "Konfirmasi Pembayaran",   desc: "Notifikasi pembayaran DP dan pelunasan" },
              { key: "weeklyReport" as const, label: "Laporan Mingguan",        desc: "Ringkasan aktivitas dikirim setiap Senin pagi" },
              { key: "marketing"    as const, label: "Info & Promosi",          desc: "Penawaran dan pembaruan produk dari TravelHub" },
            ].map((item) => (
              <ToggleRow
                key={item.key}
                label={item.label}
                desc={item.desc}
                checked={notif[item.key]}
                onChange={(v) => setNotif((n) => ({ ...n, [item.key]: v }))}
              />
            ))}
          </div>
        )}

        {tab === "security" && (
          <div className="space-y-4 max-w-xl">
            <SectionHeader title="Keamanan Akun" desc="Kelola kata sandi dan keamanan akun Anda" />

            {/* Password Change */}
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Lock className="h-4 w-4 text-[hsl(var(--primary))]" />
                <p className="text-[13px] font-semibold text-[hsl(var(--foreground))]">Ubah Kata Sandi</p>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))]">Kata Sandi Saat Ini</Label>
                <Input className="h-8 md:h-9 text-[13px] md:text-sm" type="password" placeholder="••••••••" value={security.currentPw} onChange={(e) => setSecurity((s) => ({ ...s, currentPw: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <Label className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))]">Sandi Baru</Label>
                  <Input className="h-8 md:h-9 text-[13px] md:text-sm" type="password" placeholder="min. 6 karakter" value={security.newPw} onChange={(e) => setSecurity((s) => ({ ...s, newPw: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))]">Konfirmasi</Label>
                  <Input className="h-8 md:h-9 text-[13px] md:text-sm" type="password" placeholder="••••••••" value={security.confirmPw} onChange={(e) => setSecurity((s) => ({ ...s, confirmPw: e.target.value }))} />
                </div>
              </div>
              <Button
                onClick={handleChangePassword}
                disabled={savingPassword || !security.currentPw || !security.newPw || !security.confirmPw}
                className="h-8 px-4 rounded-xl text-xs gradient-primary text-white"
              >
                {savingPassword ? "Menyimpan…" : "Simpan Kata Sandi"}
              </Button>
            </div>

            {/* Advanced Security */}
            <div className="space-y-2">
              <p className="text-[12px] font-semibold text-[hsl(var(--foreground))] px-1">Keamanan Lanjutan</p>
              <div className="flex items-center justify-between py-3 px-3 rounded-xl border border-[hsl(var(--border))] bg-white gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[12.5px] font-medium text-[hsl(var(--foreground))] leading-tight">Autentikasi 2FA</p>
                    {security.twoFactor && (
                      <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold flex items-center gap-0.5">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Aktif
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5 leading-tight">
                    {security.twoFactor ? "PIN keamanan diperlukan saat login" : "Lapisan keamanan ekstra saat login menggunakan PIN"}
                  </p>
                </div>
                <Switch checked={security.twoFactor} onCheckedChange={handleToggle2FA} className="shrink-0" />
              </div>
              <div className="flex items-center justify-between py-3 px-3 rounded-xl border border-[hsl(var(--border))] bg-white gap-3">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-[hsl(var(--foreground))] leading-tight">Notifikasi Login Baru</p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5 leading-tight">Tampilkan peringatan setiap kali ada sesi login baru</p>
                </div>
                <Switch checked={security.loginAlert} onCheckedChange={handleToggleLoginAlert} className="shrink-0" />
              </div>
            </div>

            {/* Login History */}
            {loginHistory.length > 0 && (
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[hsl(var(--border))]">
                  <Clock className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
                  <p className="text-[12px] font-semibold text-[hsl(var(--foreground))]">Riwayat Login Terakhir</p>
                </div>
                <div className="divide-y divide-[hsl(var(--border))]">
                  {loginHistory.slice(0, 5).map((event, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {i === 0 ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        ) : (
                          <div className="h-3.5 w-3.5 rounded-full border-2 border-[hsl(var(--border))] shrink-0" />
                        )}
                        <span className="text-[12px] text-[hsl(var(--foreground))]">
                          {i === 0 ? "Sesi ini" : `Login ke-${i + 1}`}
                        </span>
                      </div>
                      <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                        {new Intl.DateTimeFormat("id-ID", {
                          day: "2-digit", month: "short", year: "numeric",
                          hour: "2-digit", minute: "2-digit",
                          timeZone: "Asia/Jakarta",
                        }).format(new Date(event.at))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* PIN Setup Dialog */}
        <Dialog open={pinDialogOpen} onOpenChange={(o) => { if (!o) { setPinDialogOpen(false); setPinInput(""); setPinConfirm(""); } }}>
          <DialogContent className="max-w-xs p-0 overflow-hidden rounded-2xl border border-[hsl(var(--border))] shadow-xl bg-white">
            {/* Header */}
            <div className="px-5 pt-4 pb-3 border-b border-[hsl(var(--border))]">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
                  <KeyRound className="h-4 w-4 text-orange-600" />
                </div>
                <div>
                  <DialogTitle className="text-[13.5px] font-bold">Buat PIN Keamanan</DialogTitle>
                  <DialogDescription className="text-[10.5px] text-muted-foreground mt-0.5">
                    4–8 digit angka · Wajib saat login
                  </DialogDescription>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Buat PIN</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="••••"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
                  className="h-9 text-center tracking-[0.4em] text-base font-bold rounded-xl"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Konfirmasi PIN</Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="••••"
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ""))}
                  className={cn(
                    "h-9 text-center tracking-[0.4em] text-base font-bold rounded-xl",
                    pinConfirm && pinInput !== pinConfirm && "border-red-400 bg-red-50/30"
                  )}
                />
                {pinConfirm && pinInput !== pinConfirm && (
                  <p className="text-[10px] text-red-500">PIN tidak cocok</p>
                )}
              </div>

              <div className="flex gap-2 pt-0.5">
                <button
                  onClick={() => { setPinDialogOpen(false); setPinInput(""); setPinConfirm(""); }}
                  className="flex-1 h-9 rounded-xl text-[12px] font-semibold bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--border))] transition-colors"
                >
                  Batal
                </button>
                <button
                  onClick={handleSavePin}
                  disabled={pinLoading || pinInput.length < 4 || pinInput !== pinConfirm}
                  className="flex-1 h-9 rounded-xl text-[12px] font-bold text-white transition-all disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#f97316,#ea580c)" }}
                >
                  {pinLoading ? "Menyimpan…" : "Aktifkan 2FA"}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {tab === "appearance" && (
          <div className="space-y-4 max-w-xl">
            <SectionHeader title="Tampilan" desc="Sesuaikan tampilan aplikasi sesuai preferensi Anda" />
            <div className="space-y-1.5">
              <Label className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))]">Tema</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: "light", label: "Terang",    preview: "bg-white border" },
                  { key: "dark",  label: "Gelap",     preview: "bg-gray-800" },
                  { key: "auto",  label: "Otomatis",  preview: "bg-gradient-to-r from-white to-gray-800" },
                ].map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setAppearance((a) => ({ ...a, theme: t.key as AppearanceTheme }))}
                    className={cn(
                      "flex flex-col items-center gap-1.5 p-2.5 rounded-xl border-2 transition-all",
                      appearance.theme === t.key ? "border-[hsl(var(--primary))] bg-[hsl(var(--accent))]" : "border-[hsl(var(--border))]"
                    )}
                  >
                    <div className={cn("h-8 w-full rounded-lg border", t.preview)} />
                    <span className="text-[11px] font-medium text-[hsl(var(--foreground))]">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))]">Ukuran Teks</Label>
              <Select value={appearance.fontSize} onValueChange={(v) => setAppearance((a) => ({ ...a, fontSize: v as AppearanceFontSize }))}>
                <SelectTrigger className="h-8 md:h-9 text-[13px] md:text-sm"><SelectValue /></SelectTrigger>
                <SelectContent style={{ background: "#fff" }}>
                  <SelectItem value="small">Kecil</SelectItem>
                  <SelectItem value="medium">Sedang (Default)</SelectItem>
                  <SelectItem value="large">Besar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <ToggleRow
              label="Mode Compact"
              desc="Kurangi padding dan jarak untuk tampilan lebih padat"
              checked={appearance.compactMode}
              onChange={(v) => setAppearance((a) => ({ ...a, compactMode: v }))}
            />
          </div>
        )}

        {tab === "regional" && (
          <div className="space-y-3 max-w-xl">
            <SectionHeader title={t.settings_regional} desc={t.settings_regional_desc} />
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { key: "language",   label: t.settings_regional_lang,     opts: [{ v: "id", l: "Bahasa Indonesia" }, { v: "en", l: "English" }, { v: "ar", l: "العربية" }] },
                { key: "timezone",   label: t.settings_regional_tz,       opts: [{ v: "Asia/Jakarta", l: "WIB (UTC+7)" }, { v: "Asia/Makassar", l: "WITA (UTC+8)" }, { v: "Asia/Jayapura", l: "WIT (UTC+9)" }] },
                { key: "currency",   label: t.settings_regional_currency, opts: [{ v: "IDR", l: "IDR — Rupiah" }, { v: "USD", l: "USD — Dollar" }, { v: "SAR", l: "SAR — Riyal" }] },
                { key: "dateFormat", label: t.settings_regional_date,     opts: [{ v: "dd/mm/yyyy", l: "DD/MM/YYYY" }, { v: "mm/dd/yyyy", l: "MM/DD/YYYY" }, { v: "yyyy-mm-dd", l: "YYYY-MM-DD" }] },
              ].map((field) => (
                <div key={field.key} className="space-y-1">
                  <Label className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))]">{field.label}</Label>
                  <Select
                    value={(regional as Record<string, string>)[field.key]}
                    onValueChange={(v) => {
                      setRegional({ [field.key]: v } as Parameters<typeof setRegional>[0]);
                      toast.success(t.settings_regional_updated, { description: t.settings_regional_updated_desc });
                    }}
                  >
                    <SelectTrigger className="h-8 md:h-9 text-[13px] md:text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent style={{ background: "#fff" }}>
                      {field.opts.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {/* Live preview */}
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4 space-y-3">
              <p className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">{t.settings_regional_preview}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{t.settings_regional_number}</p>
                  <p className="text-sm font-bold text-[hsl(var(--foreground))]">
                    {currency === "IDR"
                      ? `Rp ${(25000000).toLocaleString(language === "id" ? "id-ID" : "en-US")}`
                      : currency === "USD"
                        ? `$ ${(25000000 / (rates.USD || 16000)).toLocaleString(language === "id" ? "id-ID" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : `SAR ${(25000000 / (rates.SAR || 4250)).toLocaleString(language === "id" ? "id-ID" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{t.settings_regional_date_label}</p>
                  <p className="text-sm font-bold text-[hsl(var(--foreground))]">
                    {(() => {
                      const d = new Date("2025-07-15T00:00:00");
                      if (dateFormat === "dd/mm/yyyy") {
                        const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).formatToParts(d);
                        const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "??";
                        return `${get("day")}/${get("month")}/${get("year")}`;
                      }
                      if (dateFormat === "mm/dd/yyyy") {
                        const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).formatToParts(d);
                        const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "??";
                        return `${get("month")}/${get("day")}/${get("year")}`;
                      }
                      const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).formatToParts(d);
                      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "??";
                      return `${get("year")}-${get("month")}-${get("day")}`;
                    })()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">Tanggal Panjang</p>
                  <p className="text-sm font-bold text-[hsl(var(--foreground))]">
                    {new Intl.DateTimeFormat(language === "id" ? "id-ID" : language === "ar" ? "ar-SA" : "en-US", {
                      day: "numeric", month: "long", year: "numeric", timeZone: timezone,
                    }).format(new Date("2025-07-15T00:00:00"))}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">Zona Waktu</p>
                  <p className="text-sm font-bold text-[hsl(var(--foreground))]">
                    {new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-US", {
                      hour: "2-digit", minute: "2-digit", timeZone: timezone, timeZoneName: "short",
                    }).format(new Date())}
                  </p>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-[hsl(var(--muted-foreground))] flex items-center gap-1.5">
              <Globe className="h-3 w-3 inline" />
              Perubahan disimpan otomatis dan langsung berlaku di seluruh halaman.
            </p>
          </div>
        )}

        {tab === "rates" && (
          <div className="space-y-5 max-w-xl">
            <SectionHeader title="Kurs & Buffer Harga" desc="Pakai kurs live otomatis atau kurs manual sesuai kondisi lapangan" />

            <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRateMode("live")}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-all",
                    rateMode === "live"
                      ? "border-orange-400 bg-orange-50 text-orange-600"
                      : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))]"
                  )}
                >
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <Radio className="h-4 w-4" />
                    Live
                  </div>
                  <p className="mt-1 text-[11px] leading-snug">
                    Ambil kurs otomatis dari internet, cocok untuk patokan harian.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setRateMode("manual")}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-all",
                    rateMode === "manual"
                      ? "border-orange-400 bg-orange-50 text-orange-600"
                      : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))]"
                  )}
                >
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <PencilLine className="h-4 w-4" />
                    Manual Lapangan
                  </div>
                  <p className="mt-1 text-[11px] leading-snug">
                    Isi sendiri kalau money changer/vendor pakai kurs berbeda.
                  </p>
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold">Kurs Aktif (IDR)</span>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">
                    Mode: {rateMode === "manual" ? "Manual Lapangan" : "Live Otomatis"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {lastUpdated && (
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                      Update: {lastUpdated.toLocaleTimeString("id-ID")}
                    </span>
                  )}
                  <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg" onClick={() => refreshRates()} disabled={ratesLoading}>
                    <RefreshCw className={cn("h-3 w-3 mr-1", ratesLoading && "animate-spin")} />
                    {ratesLoading ? "Memuat…" : "Refresh"}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 divide-x divide-[hsl(var(--border))]">
                {(["USD", "SAR"] as const).map((cur) => (
                  <div key={cur} className="px-5 py-4">
                    <p className="text-xs text-[hsl(var(--muted-foreground))] font-medium">1 {cur} =</p>
                    <p className="text-xl font-bold text-[hsl(var(--foreground))] mt-1">
                      Rp {rates[cur].toLocaleString("id-ID")}
                    </p>
                    {markupPct > 0 && (
                      <p className="text-[10px] text-orange-500 mt-0.5">
                        Dasar: Rp {rawRates[cur].toLocaleString("id-ID")} + {markupPct}% markup
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-5 space-y-4">
              <div>
                <Label className="text-sm font-semibold">Kurs Manual Lapangan</Label>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
                  Nilai ini dipakai saat mode Manual Lapangan aktif.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(["USD", "SAR"] as const).map((cur) => (
                  <div key={cur} className="space-y-1">
                    <Label className="text-[10px] md:text-[11px] text-[hsl(var(--muted-foreground))]">1 {cur} = Rp</Label>
                    <Input
                      type="number"
                      min={1}
                      value={manualRates[cur]}
                      onChange={(e) => setManualRate(cur, Number(e.target.value))}
                      className="h-10 text-sm"
                    />
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                      Live saat ini: Rp {rawRates[cur].toLocaleString("id-ID")}
                    </p>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant={rateMode === "manual" ? "default" : "outline"}
                className={cn("h-9 rounded-xl text-xs", rateMode === "manual" && "gradient-primary text-white")}
                onClick={() => {
                  setRateMode("manual");
                  toast.success("Kurs manual dipakai untuk kalkulator.");
                }}
              >
                Pakai Kurs Manual
              </Button>
            </div>

            <div className="rounded-2xl border border-[hsl(var(--border))] bg-white p-5 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold">Buffer / Markup Harga</Label>
                  <span className="text-sm font-bold text-orange-500">{markupPct.toFixed(1)}%</span>
                </div>
                <Slider
                  min={0}
                  max={5}
                  step={0.5}
                  value={[markupPct]}
                  onValueChange={([v]) => setMarkup(v)}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-[hsl(var(--muted-foreground))] mt-1.5">
                  <span>0% (tanpa markup)</span>
                  <span>5% (aman dari fluktuasi)</span>
                </div>
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] bg-orange-50 rounded-xl px-3 py-2 border border-orange-100">
                Markup akan ditambahkan ke kurs aktif, baik live maupun manual. Direkomendasikan 1–2% untuk melindungi margin dari fluktuasi harian.
              </p>
            </div>
          </div>
        )}

        {tab === "agents" && (
          <div className="space-y-5 max-w-xl">
            <SectionHeader title="Manajemen Tim" desc="Owner mengundang staf agar bisa login & berbagi data agency" />

            {isOwner && (
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
                  <p className="text-sm font-semibold">Undang Staf Baru</p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
                    Akun langsung aktif; password awal dibagikan secara aman ke staf.
                  </p>
                </div>
                <div className="p-4 grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Email</Label>
                    <Input type="email" value={newMemberEmail} onChange={(e) => setNewMemberEmail(e.target.value)} placeholder="staf@agency.com" className="h-8 md:h-9 text-[13px] md:text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nama Lengkap</Label>
                    <Input value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} placeholder="cth: Ahmad Fauzi" className="h-8 md:h-9 text-[13px] md:text-sm" />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs">Password Awal (min 8)</Label>
                    <div className="flex gap-2">
                      <Input type="password" value={newMemberPass} onChange={(e) => setNewMemberPass(e.target.value)} placeholder="••••••••" className="h-8 md:h-9 text-[13px] md:text-sm" />
                      <Button onClick={handleInviteMember} disabled={invitingMember} className="h-9 px-4 rounded-xl gradient-primary text-white shrink-0">
                        <Plus className="h-4 w-4 mr-1" /> {invitingMember ? "Mengundang…" : "Undang"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
                <p className="text-sm font-semibold">Anggota Agency ({members.length})</p>
              </div>
              <div className="divide-y divide-[hsl(var(--border))]">
                {members.length === 0 && (
                  <p className="px-4 py-6 text-center text-xs text-[hsl(var(--muted-foreground))]">Belum ada anggota lain.</p>
                )}
                {members.map((m) => (
                  <div key={m.userId} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{m.displayName || m.email}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono">{m.email}</span>
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-semibold",
                          m.role === "owner" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"
                        )}>{m.role}</span>
                      </div>
                    </div>
                    {isOwner && m.role !== "owner" && m.userId !== user?.id && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-red-50 hover:text-red-500"
                        onClick={() => handleRemoveMember(m.userId, m.displayName || m.email)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {isOwner && (
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
                  <p className="text-sm font-semibold">Migrasi Penyimpanan</p>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
                    Pindahkan foto & dokumen lama (base64 di DB) ke Supabase Storage. Aman dijalankan ulang.
                  </p>
                </div>
                <div className="p-4 space-y-3">
                  {migrateProgress && (
                    <div className="rounded-xl bg-[hsl(var(--accent))] px-3 py-2 text-[12px] text-[hsl(var(--foreground))]">
                      Phase: <strong>{migrateProgress.phase}</strong> — {migrateProgress.done}/{migrateProgress.total}
                      {migrateProgress.failed > 0 && <span className="text-red-600"> · gagal: {migrateProgress.failed}</span>}
                    </div>
                  )}
                  <Button onClick={handleMigrate} disabled={migrating} className="h-9 px-4 rounded-xl gradient-primary text-white">
                    <RefreshCw className={cn("h-4 w-4 mr-1.5", migrating && "animate-spin")} />
                    {migrating ? "Migrasi berjalan…" : "Mulai Migrasi Storage"}
                  </Button>
                </div>
              </div>
            )}

            {!isOwner && (
              <p className="text-[12px] text-[hsl(var(--muted-foreground))] text-center pt-2">
                Hanya owner agency yang dapat mengundang/menghapus anggota & menjalankan migrasi.
              </p>
            )}
          </div>
        )}

        {tab === "audit" && <AuditLogPanel />}

        {tab === "status" && <ConnectionHealthPanel />}

        {/* Save */}
        {tab !== "audit" && tab !== "status" && (
          <div className="mt-6 pt-4 border-t border-[hsl(var(--border))] max-w-xl">
            <Button onClick={handleSave} className="gradient-primary text-white shadow-glow hover:opacity-90 rounded-xl h-9 px-5 text-sm">
              <Save strokeWidth={1.5} className="h-3.5 w-3.5 mr-2" /> Simpan Perubahan
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

type CheckStatus = "idle" | "running" | "ok" | "warn" | "fail";
interface HealthCheck {
  key: string;
  label: string;
  desc: string;
  Icon: typeof Database;
  status: CheckStatus;
  message?: string;
  detail?: string;
  durationMs?: number;
}

function ConnectionHealthPanel() {
  const user = useAuthStore((s) => s.user);
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const runChecks = async () => {
    setRunning(true);
    const initial: HealthCheck[] = [
      { key: "config",  label: "Konfigurasi Env", desc: "VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY", Icon: Cloud,     status: "running" },
      { key: "auth",    label: "Sesi Login",      desc: "Token aktif & user info dari Supabase Auth", Icon: UserCheck, status: "running" },
      { key: "agency",  label: "Agency Member",   desc: "User ter-link ke agency di tabel agency_members", Icon: Users, status: "running" },
      { key: "db",      label: "Database Read",   desc: "SELECT dari tabel packages (uji RLS)",       Icon: Database,  status: "running" },
      { key: "storage", label: "Storage",         desc: "List bucket jamaah-photos",                  Icon: HardDrive, status: "running" },
    ];
    setChecks(initial);

    const upd = (key: string, patch: Partial<HealthCheck>) =>
      setChecks((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));

    const time = async <T,>(fn: () => PromiseLike<T>): Promise<{ result: T; ms: number }> => {
      const t0 = performance.now();
      const result = await fn();
      return { result, ms: Math.round(performance.now() - t0) };
    };

    // 1. Env config
    if (!isSupabaseConfigured()) {
      upd("config", { status: "fail", message: "Supabase belum dikonfigurasi", detail: "VITE_SUPABASE_URL atau VITE_SUPABASE_ANON_KEY kosong di environment." });
      ["auth", "agency", "db", "storage"].forEach((k) => upd(k, { status: "warn", message: "Skip — Supabase tidak aktif" }));
      setRunning(false);
      setLastRun(new Date());
      return;
    }
    upd("config", { status: "ok", message: SUPABASE_URL.replace(/^https?:\/\//, "") });

    // 2. Auth session
    let authedUserId: string | null = null;
    try {
      const { result, ms } = await time(() => supabase!.auth.getSession());
      const session = result.data.session;
      if (!session) {
        upd("auth", { status: "fail", message: "Belum login", detail: "Tidak ada session aktif. Silakan login ulang.", durationMs: ms });
      } else {
        authedUserId = session.user.id;
        upd("auth", { status: "ok", message: session.user.email ?? "Logged in", detail: `User ID: ${session.user.id.slice(0, 8)}…`, durationMs: ms });
      }
    } catch (e) {
      upd("auth", { status: "fail", message: extractErr(e) });
    }

    // 3. Agency membership
    if (!authedUserId) {
      upd("agency", { status: "warn", message: "Skip — perlu login dulu" });
    } else {
      try {
        const { result, ms } = await time(() =>
          supabase!.from("agency_members").select("agency_id, role").eq("user_id", authedUserId!).maybeSingle()
        );
        if (result.error) {
          upd("agency", { status: "fail", message: extractErr(result.error), detail: "Cek RLS policy untuk tabel agency_members.", durationMs: ms });
        } else if (!result.data) {
          upd("agency", { status: "fail", message: "User belum ter-link ke agency manapun", detail: "Insert row di tabel agency_members atau buat agency baru.", durationMs: ms });
        } else {
          upd("agency", { status: "ok", message: `Role: ${result.data.role}`, detail: `Agency ID: ${String(result.data.agency_id).slice(0, 8)}…`, durationMs: ms });
        }
      } catch (e) {
        upd("agency", { status: "fail", message: extractErr(e) });
      }
    }

    // 4. DB read (packages)
    try {
      const { result, ms } = await time(() =>
        supabase!.from("packages").select("id", { count: "exact", head: true })
      );
      if (result.error) {
        upd("db", { status: "fail", message: extractErr(result.error), detail: "Kemungkinan masalah RLS, schema, atau jaringan.", durationMs: ms });
      } else {
        upd("db", { status: "ok", message: `OK · ${result.count ?? 0} paket`, durationMs: ms });
      }
    } catch (e) {
      upd("db", { status: "fail", message: extractErr(e) });
    }

    // 5. Storage
    try {
      const { result, ms } = await time(() =>
        supabase!.storage.from("jamaah-photos").list("", { limit: 1 })
      );
      if (result.error) {
        upd("storage", { status: "fail", message: extractErr(result.error), detail: "Cek bucket & storage policy.", durationMs: ms });
      } else {
        upd("storage", { status: "ok", message: "Bucket jamaah-photos accessible", durationMs: ms });
      }
    } catch (e) {
      upd("storage", { status: "fail", message: extractErr(e) });
    }

    setLastRun(new Date());
    setRunning(false);
  };

  useEffect(() => { runChecks(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const overall: CheckStatus = checks.some((c) => c.status === "fail")
    ? "fail"
    : checks.some((c) => c.status === "warn")
    ? "warn"
    : checks.every((c) => c.status === "ok")
    ? "ok"
    : "running";

  const overallMeta = {
    ok:      { color: "from-emerald-500 to-emerald-600", text: "Semua sistem normal", Icon: CheckCircle2 },
    warn:    { color: "from-amber-500 to-amber-600",     text: "Ada peringatan",       Icon: AlertCircle },
    fail:    { color: "from-red-500 to-red-600",         text: "Ada masalah",          Icon: XCircle },
    running: { color: "from-slate-400 to-slate-500",     text: "Mengecek…",            Icon: RefreshCw },
    idle:    { color: "from-slate-400 to-slate-500",     text: "Belum dicek",          Icon: Activity },
  }[overall];

  return (
    <div className="space-y-4 max-w-2xl">
      <SectionHeader title="Status Koneksi" desc="Diagnostik realtime untuk Supabase, Auth, Database, dan Storage." />

      {/* Overall card */}
      <div className={cn("rounded-2xl bg-gradient-to-br text-white p-4 shadow-lg", overallMeta.color)}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
              <overallMeta.Icon className={cn("h-5 w-5", overall === "running" && "animate-spin")} />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80">Status Keseluruhan</p>
              <p className="text-[15px] font-bold leading-tight">{overallMeta.text}</p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={runChecks}
            disabled={running}
            className="h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white border-0 backdrop-blur-sm"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", running && "animate-spin")} />
            {running ? "Cek…" : "Cek Ulang"}
          </Button>
        </div>
        {lastRun && (
          <p className="text-[10.5px] opacity-80 mt-2 ml-13">
            Terakhir dicek: {lastRun.toLocaleTimeString("id-ID")}
            {user?.agencyName && <span> · Agency: {user.agencyName}</span>}
          </p>
        )}
      </div>

      {/* Individual checks */}
      <ul className="space-y-2">
        {checks.map((c) => (
          <CheckRow key={c.key} check={c} />
        ))}
      </ul>

      <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-[11.5px] text-slate-700 leading-relaxed">
        <p className="font-semibold text-blue-900 mb-1 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" /> Tips Diagnostik
        </p>
        <ul className="space-y-1 list-disc pl-4">
          <li><b>Sesi Login gagal:</b> token expired — logout & login ulang.</li>
          <li><b>Agency Member gagal:</b> user belum punya row di tabel <code className="font-mono bg-white px-1 rounded">agency_members</code>.</li>
          <li><b>Database Read gagal:</b> biasanya RLS policy belum di-apply atau env vars salah.</li>
          <li><b>Storage gagal:</b> bucket belum dibuat atau policy salah.</li>
        </ul>
      </div>
    </div>
  );
}

function CheckRow({ check }: { check: HealthCheck }) {
  const meta = {
    ok:      { ring: "ring-emerald-200", bg: "bg-emerald-50", dot: "bg-emerald-500", text: "text-emerald-700", label: "OK" },
    warn:    { ring: "ring-amber-200",   bg: "bg-amber-50",   dot: "bg-amber-500",   text: "text-amber-700",   label: "WARN" },
    fail:    { ring: "ring-red-200",     bg: "bg-red-50",     dot: "bg-red-500",     text: "text-red-700",     label: "FAIL" },
    running: { ring: "ring-slate-200",   bg: "bg-slate-50",   dot: "bg-slate-400 animate-pulse", text: "text-slate-600", label: "…" },
    idle:    { ring: "ring-slate-200",   bg: "bg-white",      dot: "bg-slate-300",   text: "text-slate-500",   label: "—" },
  }[check.status];

  return (
    <li className={cn("rounded-xl ring-1 bg-white p-3", meta.ring)}>
      <div className="flex items-start gap-3">
        <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", meta.bg)}>
          <check.Icon className={cn("h-4 w-4", meta.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-bold text-slate-900">{check.label}</p>
            <span className={cn("inline-flex items-center gap-1 text-[9.5px] font-bold px-1.5 py-0.5 rounded-md", meta.bg, meta.text)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
              {meta.label}
            </span>
            {check.durationMs != null && (
              <span className="text-[10px] text-slate-400 font-mono">{check.durationMs}ms</span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">{check.desc}</p>
          {check.message && (
            <p className={cn("text-[12px] font-medium mt-1.5", meta.text)}>{check.message}</p>
          )}
          {check.detail && (
            <p className="text-[11px] text-slate-500 mt-0.5 font-mono break-words">{check.detail}</p>
          )}
        </div>
      </div>
    </li>
  );
}

function extractErr(e: unknown): string {
  const err = e as { message?: string; hint?: string; details?: string; code?: string };
  return err?.message || err?.hint || err?.details || (typeof e === "string" ? e : "Unknown error");
}

function AuditLogPanel() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      setLogs(await listRecentAuditLogs(100));
    } catch (err) {
      console.error("[audit] load failed", err);
      toast.error("Gagal memuat audit log.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const actionMeta = (a: AuditLog["action"]) => {
    if (a === "INSERT") return { Icon: FilePlus, color: "bg-emerald-100 text-emerald-700", label: "BUAT" };
    if (a === "UPDATE") return { Icon: FileEdit, color: "bg-blue-100 text-blue-700", label: "UBAH" };
    return { Icon: FileX, color: "bg-red-100 text-red-700", label: "HAPUS" };
  };

  const fmtTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const now = Date.now();
      const diff = (now - d.getTime()) / 1000;
      if (diff < 60) return "baru saja";
      if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
      if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
      return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
    } catch { return iso; }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <SectionHeader title="Audit Log" desc="100 aktivitas terakhir di agency-mu (otomatis dicatat oleh sistem)" />
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={reload} disabled={loading} className="h-8 rounded-xl">
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
          {loading ? "Memuat…" : "Muat Ulang"}
        </Button>
      </div>
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="p-6 text-center text-xs text-[hsl(var(--muted-foreground))]">Memuat audit log…</div>
        ) : logs.length === 0 ? (
          <div className="p-6 text-center text-xs text-[hsl(var(--muted-foreground))]">Belum ada aktivitas tercatat.</div>
        ) : (
          <ul className="divide-y divide-[hsl(var(--border))]">
            {logs.map((log) => {
              const { Icon, color, label } = actionMeta(log.action);
              return (
                <li key={log.id} className="flex items-start gap-3 px-4 py-3">
                  <div className={cn("h-8 w-8 rounded-xl flex items-center justify-center shrink-0", color)}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-md", color)}>{label}</span>
                      <p className="text-[13px] font-medium text-[hsl(var(--foreground))] truncate">{describeChange(log)}</p>
                    </div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
                      {fmtTime(log.createdAt)}
                      {log.userId && <span className="ml-2 font-mono">· user {log.userId.slice(0, 8)}</span>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
