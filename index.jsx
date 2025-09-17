import React, { useMemo, useRef, useState } from "react";

// >>> Google Sheets Web App endpoint (deploy from Apps Script and paste the Web App URL here)
const SHEETS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbxqxFWjzi7m9tClTMxgUhAhEM62I_dxGfrYnN0KmewHDqYCvfgo-Kb8WQ6aSkYk2r2j/exec"; // TODO: ganti dengan URL Web App Anda
// Opsional: jika ingin pisahkan endpoint upload file & append sheet, Anda bisa buat 2 Web App. Untuk versi sederhana ini, kita pakai 1 endpoint yang menerima JSON + file base64 lalu menyimpan ke Drive dan mencatat link di Sheet.

// Single-file React form app. TailwindCSS is available in this environment.
// No backend required: on submit, we show a confirmation screen and provide a JSON download of the submission.

export default function App() {
  const [step, setStep] = useState<"form" | "thankyou">("form");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // ------ Auto fields ------
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const generateNUP = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const rand = Math.floor(Math.random() * 9000 + 1000); // 4 digits
    return `NUP-${y}${m}${day}-${rand}`;
  };
  const [nomorNUP] = useState<string>(generateNUP());
  const [tanggalDaftarNUP] = useState<string>(todayISO);
  const [tanggalReleaseNUP] = useState<string>(todayISO); // if needed, can be adjusted by admin later

  // ------ Form state ------
  const [form, setForm] = useState({
    nama: "",
    ktp: "",
    alamat: "",
    hp: "",
    email: "",
    jumlahNUP: "",
    caraBayar: "Tunai" as "Tunai" | "Transfer",
    kehadiran: "Hadir sendiri" as "Hadir sendiri" | "Diwakilkan dengan Surat Kuasa" | "Tidak hadir / mengundurkan diri",
    setujuKetentuan: false,
    captcha: "",
    files: [] as File[],
  });

  // ------ Helpers ------
  // Baca file sebagai base64 (untuk upload ke Apps Script)
  const fileToBase64 = (file: File) => new Promise<{name:string; type:string; base64:string}>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.split(",")[1] || ""; // remove data:*/*;base64,
      resolve({ name: file.name, type: file.type || "application/octet-stream", base64 });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const filesToBase64 = async (files: File[]) => {
    const out = [] as {name:string; type:string; base64:string}[];
    for (const f of files) {
      // ukuran sudah diverifikasi 10MB di onFilesChange
      // konversi base64
      // eslint-disable-next-line no-await-in-loop
      const b64 = await fileToBase64(f);
      out.push(b64);
    }
    return out;
  };

  const rupiahOnly = (value: string) => value.replace(/[^0-9]/g, "");
  const formatRupiah = (digits: string) => {
    if (!digits) return "";
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  const onChange = (field: keyof typeof form, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const onJumlahChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = rupiahOnly(e.target.value);
    onChange("jumlahNUP", formatRupiah(raw));
  };

  const onFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    // filter by type and size
    const accepted = files.filter(f => {
      const okType = ["image/jpeg", "image/png", "application/pdf"].includes(f.type) || /\.(jpg|jpeg|png|pdf)$/i.test(f.name);
      const okSize = f.size <= 10 * 1024 * 1024; // 10MB
      return okType && okSize;
    });
    onChange("files", accepted);
  };

  // ------ Network helper (Google Sheets) ------
  const sendToSheets = async (payload: any) => {
    const body = JSON.stringify(payload);
    // 1) CORS-friendly attempt (no preflight): use text/plain
    try {
      const res = await fetch(SHEETS_WEBAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body,
      });
      // Treat opaque as success (some proxies/GAS return opaque)
      if (res.ok || res.type === "opaque") return true;
      throw new Error(`HTTP ${res.status}`);
    } catch (err1) {
      // 2) Fallback: no-cors (cannot read response, but request is sent)
      try {
        await fetch(SHEETS_WEBAPP_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body,
          mode: "no-cors",
        });
        return true;
      } catch (err2) {
        // 3) Final fallback: sendBeacon
        try {
          if (navigator.sendBeacon) {
            const ok = navigator.sendBeacon(SHEETS_WEBAPP_URL, new Blob([body], { type: "text/plain;charset=utf-8" }));
            if (ok) return true;
          }
        } catch {}
        throw err2 || err1;
      }
    }
  };

  // ------ Validation ------
  const validate = () => {
    const err: Record<string, string> = {};
    if (!form.nama.trim()) err.nama = "Wajib diisi";
    if (!form.ktp.trim()) err.ktp = "Wajib diisi";
    if (!form.alamat.trim()) err.alamat = "Wajib diisi";
    // Indo phone simple pattern: digits 9-15, may start with +62 or 0
    const phoneDigits = form.hp.replace(/\s|-/g, "");
    if (!form.hp.trim()) err.hp = "Wajib diisi";
    else if (!/^((\+62)|0)[0-9]{8,14}$/.test(phoneDigits)) err.hp = "Nomor HP tidak valid";
    if (!form.email.trim()) err.email = "Wajib diisi";
    else if (!/^\S+@\S+\.\S+$/.test(form.email)) err.email = "Email tidak valid";

    // jumlah NUP numeric optional? The spec says short answer → format angka (not explicitly wajib). We can allow empty, but if filled must be numeric.
    if (form.jumlahNUP && !/^\d{1,3}(\.\d{3})*$/.test(form.jumlahNUP)) err.jumlahNUP = "Gunakan angka (contoh: 5.000.000)";

    if (!form.setujuKetentuan) err.setujuKetentuan = "Anda harus menyetujui ketentuan";
    if (form.captcha.trim() !== "SETUJU") err.captcha = "Ketik persis: SETUJU";

    setErrors(err);
    return Object.keys(err).length === 0;
  };

  // ------ Submit ------
  const downloadRef = useRef<HTMLAnchorElement | null>(null);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;

    setSubmitting(true);

    // Siapkan file base64 jika ada (untuk upload ke Google Drive lewat Apps Script)
    let base64Files: {name:string; type:string; base64:string}[] = [];
    try {
      base64Files = await filesToBase64(form.files);
    } catch (readErr) {
      setSubmitting(false);
      setServerError("Gagal membaca file untuk diunggah. Coba ulangi atau kurangi ukuran file.");
      return;
    }

    // Prepare payload
    const payload = {
      formTitle: "Release Pembelian (Nomor Urut Pemesanan – NUP)",
      formDescription:
        "Formulir ini digunakan untuk pendaftaran dan pencatatan NUP (Nomor Urut Pemesanan) pembelian unit di Perumahan Griya Land Sumbang. Harap isi data dengan benar.",
      timestamp: new Date().toISOString(),
      bagian1_identitas: {
        nama: form.nama,
        noKTP: form.ktp,
        alamatDomisili: form.alamat,
        noHP_WA: form.hp,
        email: form.email,
      },
      bagian2_infoNUP: {
        nomorNUP: nomorNUP,
        tanggalDaftarNUP: tanggalDaftarNUP,
        jumlahNUPDibayarkan_Rp: form.jumlahNUP,
        caraPembayaranNUP: form.caraBayar,
        tanggalReleaseNUP: tanggalReleaseNUP,
      },
      bagian3_ketentuan: {
        konfirmasiKehadiran: form.kehadiran,
        batalMembeli: "Dana NUP tidak dikembalikan (hangus)",
        pernyataanPersetujuan: form.setujuKetentuan,
      },
      bagian4_ttd: {
        fileCount: form.files.length,
        fileNames: form.files.map(f => f.name),
        // kirim file dalam bentuk base64 untuk disimpan ke Google Drive oleh Apps Script
        filesBase64: base64Files, // [{name,type,base64}]
      },
    };

    try {
      // 1) Kirim ke Google Sheets via Apps Script Web App
      if (SHEETS_WEBAPP_URL.includes("PASTE_YOUR_DEPLOYED_WEB_APP_ID")) {
        console.warn("[INFO] SHEETS_WEBAPP_URL belum diisi. Lewati pengiriman ke Sheets.");
      } else {
        await sendToSheets(payload);
      }

      // 2) Opsional: Download lokal sebagai bukti pendaftaran
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = downloadRef.current;
      if (a) {
        a.href = url;
        a.download = `${nomorNUP.replace(/[^A-Za-z0-9-]/g, "_")}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }

      setStep("thankyou");
    } catch (err: any) {
      console.error(err);
      setServerError(err?.message || "Terjadi kesalahan saat mengirim data.");
    } finally {
      setSubmitting(false);
    }
  };

  // UI helpers
  const Label = ({ htmlFor, children, required = false }: { htmlFor?: string; children: React.ReactNode; required?: boolean }) => (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1">
      {children} {required && <span className="text-red-600">*</span>}
    </label>
  );

  const FieldError = ({ name }: { name: string }) => (
    errors[name] ? <p className="mt-1 text-sm text-red-600">{errors[name]}</p> : null
  );

  if (step === "thankyou") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-xl w-full bg-white rounded-2xl shadow p-8 text-center">
          <h1 className="text-2xl font-bold mb-2">Terima kasih!</h1>
          <p className="text-gray-700 mb-4">Data Anda sudah kami terima. Tim marketing akan segera menghubungi Anda untuk langkah melakukan Pembayaran.</p>
          <div className="border rounded-xl p-4 text-left bg-gray-50">
            <p className="text-sm text-gray-600 mb-1">Nomor NUP</p>
            <p className="font-semibold text-lg">{nomorNUP}</p>
            <p className="text-sm text-gray-600 mt-2">Tanggal Daftar NUP</p>
            <p className="font-medium">{tanggalDaftarNUP}</p>
          </div>
          <a ref={downloadRef} className="hidden" aria-hidden />
          <button onClick={() => setStep("form")} className="mt-6 inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-gray-900 text-white hover:bg-black">Kembali ke Form</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <a ref={downloadRef} className="hidden" aria-hidden />
      <div className="mx-auto max-w-3xl px-4">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Release Pembelian (Nomor Urut Pemesanan – NUP)</h1>
          <p className="text-gray-700 mt-2">Formulir ini digunakan untuk pendaftaran dan pencatatan NUP (Nomor Urut Pemesanan) pembelian unit di Perumahan Griya Land Sumbang. Harap isi data dengan benar.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Bagian 1 */}
          <section className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Bagian 1: Identitas Pemesan</h2>
            <div className="grid grid-cols-1 gap-5">
              <div>
                <Label htmlFor="nama" required>Nama Lengkap</Label>
                <input id="nama" type="text" className="w-full rounded-xl border-gray-300 focus:ring-2 focus:ring-gray-900 focus:border-gray-900" value={form.nama} onChange={e => onChange("nama", e.target.value)} placeholder="Tuliskan nama sesuai KTP" />
                <FieldError name="nama" />
              </div>

              <div>
                <Label htmlFor="ktp" required>No. KTP</Label>
                <input id="ktp" type="text" className="w-full rounded-xl border-gray-300 focus:ring-2 focus:ring-gray-900 focus:border-gray-900" value={form.ktp} onChange={e => onChange("ktp", e.target.value)} placeholder="16 digit NIK" />
                <FieldError name="ktp" />
              </div>

              <div>
                <Label htmlFor="alamat" required>Alamat Domisili</Label>
                <textarea id="alamat" className="w-full rounded-xl border-gray-300 focus:ring-2 focus:ring-gray-900 focus:border-gray-900" rows={3} value={form.alamat} onChange={e => onChange("alamat", e.target.value)} placeholder="Alamat lengkap sesuai domisili" />
                <FieldError name="alamat" />
              </div>

              <div>
                <Label htmlFor="hp" required>No. HP/WA</Label>
                <input id="hp" type="tel" className="w-full rounded-xl border-gray-300 focus:ring-2 focus:ring-gray-900 focus:border-gray-900" value={form.hp} onChange={e => onChange("hp", e.target.value)} placeholder="Contoh: 081234567890 atau +6281234567890" />
                <FieldError name="hp" />
              </div>

              <div>
                <Label htmlFor="email" required>Email</Label>
                <input id="email" type="email" className="w-full rounded-xl border-gray-300 focus:ring-2 focus:ring-gray-900 focus:border-gray-900" value={form.email} onChange={e => onChange("email", e.target.value)} placeholder="email@contoh.com" />
                <FieldError name="email" />
              </div>
            </div>
          </section>

          {/* Bagian 2 */}
          <section className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Bagian 2: Informasi NUP</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <Label>Nomor NUP (Otomatis)</Label>
                <input type="text" className="w-full rounded-xl border-gray-300 bg-gray-100" value={nomorNUP} disabled />
              </div>
              <div>
                <Label>Tanggal Daftar NUP (Otomatis)</Label>
                <input type="date" className="w-full rounded-xl border-gray-300 bg-gray-100" value={tanggalDaftarNUP} disabled />
              </div>
              <div>
                <Label htmlFor="jumlah">Jumlah NUP Dibayarkan (Rp)</Label>
                <input id="jumlah" inputMode="numeric" className="w-full rounded-xl border-gray-300 focus:ring-2 focus:ring-gray-900 focus:border-gray-900" value={form.jumlahNUP} onChange={onJumlahChange} placeholder="Contoh: 5.000.000" />
                <FieldError name="jumlahNUP" />
              </div>
              <div>
                <Label>Cara Pembayaran NUP</Label>
                <div className="flex items-center gap-6 mt-2">
                  {(["Tunai", "Transfer"] as const).map(opt => (
                    <label key={opt} className="inline-flex items-center gap-2">
                      <input type="radio" name="caraBayar" checked={form.caraBayar === opt} onChange={() => onChange("caraBayar", opt)} />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2">
                <Label>Tanggal Release NUP (Otomatis)</Label>
                <input type="date" className="w-full rounded-xl border-gray-300 bg-gray-100" value={tanggalReleaseNUP} disabled />
              </div>
            </div>
          </section>

          {/* Bagian 3 */}
          <section className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Bagian 3: Ketentuan Release NUP</h2>
            <div className="grid grid-cols-1 gap-5">
              <div>
                <Label>Konfirmasi Kehadiran saat Release Day</Label>
                <div className="flex flex-col gap-2 mt-2">
                  {(["Hadir sendiri", "Diwakilkan dengan Surat Kuasa", "Tidak hadir / mengundurkan diri"] as const).map(opt => (
                    <label key={opt} className="inline-flex items-center gap-2">
                      <input type="radio" name="kehadiran" checked={form.kehadiran === opt} onChange={() => onChange("kehadiran", opt)} />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-900">
                <strong>Catatan:</strong> Apabila batal membeli unit, dana NUP <strong>tidak dikembalikan (hangus)</strong>.
              </div>

              <div>
                <label className="inline-flex items-start gap-3">
                  <input type="checkbox" checked={form.setujuKetentuan} onChange={e => onChange("setujuKetentuan", e.target.checked)} />
                  <span>
                    Saya menyatakan data yang saya isi benar adanya dan menyetujui ketentuan release NUP yang ditetapkan developer.
                  </span>
                </label>
                <FieldError name="setujuKetentuan" />
              </div>
            </div>
          </section>

          {/* Bagian 4 */}
          <section className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Bagian 4: Tanda Tangan Digital</h2>
            <Label htmlFor="files">Upload Tanda Tangan / KTP (opsional, JPG/PNG/PDF, maks 10 MB)</Label>
            <input id="files" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" multiple onChange={onFilesChange} className="block w-full text-sm text-gray-900 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-gray-900 file:text-white hover:file:bg-black" />
            {form.files.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm text-gray-700">
                {form.files.map((f, i) => (
                  <li key={`${f.name}-${i}`}>{f.name}</li>
                ))}
              </ul>
            )}
          </section>

          {/* Bagian 5 */}
          <section className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Bagian 5: Konfirmasi</h2>
            <div>
              <Label htmlFor="captcha" required>Captcha Manual</Label>
              <input id="captcha" type="text" className="w-full rounded-xl border-gray-300 focus:ring-2 focus:ring-gray-900 focus:border-gray-900" value={form.captcha} onChange={e => onChange("captcha", e.target.value.toUpperCase())} placeholder="Tulis kata: SETUJU" />
              <FieldError name="captcha" />
            </div>
          </section>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <div className="text-left">
              <p className="text-sm text-gray-600">Tanda <span className="text-red-600">*</span> berarti wajib diisi.</p>
              {serverError && (
                <p className="mt-2 text-sm text-red-600">{serverError}</p>
              )}
            </div>
            <button type="submit" disabled={submitting} className={`inline-flex items-center justify-center px-6 py-3 rounded-xl text-white font-medium shadow ${submitting ? "bg-gray-400 cursor-not-allowed" : "bg-gray-900 hover:bg-black"}`}>
              {submitting ? "Mengirim..." : "Kirim Pendaftaran NUP"}
            </button>
          </div>
        </form>

        {/* Footer */}
        <div className="mt-10 text-center text-xs text-gray-500">
          © {new Date().getFullYear()} Griya Land Sumbang · Form NUP
        </div>
      </div>
    </div>
  );
}
