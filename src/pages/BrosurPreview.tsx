import { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toPng } from "html-to-image";
import { PDFDocument } from "pdf-lib";

const PRICING = [
  { pax: "17–21", quad: "44,4 jt", triple: "45,4 jt", double: "50,6 jt" },
  { pax: "22–26", quad: "42,7 jt", triple: "45,5 jt", double: "48,8 jt" },
  { pax: "27–31", quad: "41,6 jt", triple: "43,7 jt", double: "49,4 jt" },
  { pax: "32–36", quad: "40,9 jt", triple: "43,4 jt", double: "48,4 jt" },
  { pax: "37–41", quad: "40,3 jt", triple: "42,8 jt", double: "47,8 jt" },
  { pax: "42–45", quad: "39,8 jt", triple: "42,3 jt", double: "47,3 jt" },
];

const SUDAH_TERMASUK = [
  "Visa Umroh, Siskopatuh",
  "Tiket Pesawat, Muthawif 6x",
  "Dokumentasi",
  "Zam Zam 5 ltr/ pax",
  "All Transport Bus + HHR Train",
];

const BELUM_TERMASUK = [
  "Vaksinasi",
  "Pembuatan Paspor",
  "Personal Expenses",
  "Wisata Kota Thaif",
];

export default function BrosurPreview() {
  const brosurRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<"png" | "pdf" | null>(null);

  async function exportPng() {
    if (!brosurRef.current) return;
    setExporting("png");
    try {
      const dataUrl = await toPng(brosurRef.current, {
        pixelRatio: 3,
        backgroundColor: "#fff",
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "Penawaran_Paket_Umroh_Group12Hari.png";
      a.click();
    } finally {
      setExporting(null);
    }
  }

  async function exportPdf() {
    if (!brosurRef.current) return;
    setExporting("pdf");
    try {
      const dataUrl = await toPng(brosurRef.current, {
        pixelRatio: 3,
        backgroundColor: "#fff",
      });
      const pdfDoc = await PDFDocument.create();
      const pngBytes = await fetch(dataUrl).then((r) => r.arrayBuffer());
      const pngImage = await pdfDoc.embedPng(pngBytes);
      const { width: iw, height: ih } = pngImage;
      const page = pdfDoc.addPage([iw, ih]);
      page.drawImage(pngImage, { x: 0, y: 0, width: iw, height: ih });
      const bytes = await pdfDoc.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Penawaran_Paket_Umroh_Group12Hari.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center py-8 px-4">
      {/* Export buttons */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={exportPng}
          disabled={!!exporting}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold px-5 py-2.5 rounded-xl shadow-md transition-colors disabled:opacity-60 text-sm"
        >
          {exporting === "png" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Unduh PNG
        </button>
        <button
          onClick={exportPdf}
          disabled={!!exporting}
          className="flex items-center gap-2 bg-white hover:bg-gray-50 text-orange-600 border border-orange-300 font-bold px-5 py-2.5 rounded-xl shadow-md transition-colors disabled:opacity-60 text-sm"
        >
          {exporting === "pdf" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Unduh PDF
        </button>
      </div>

      {/* Brochure */}
      <div
        ref={brosurRef}
        style={{
          width: 794,
          minHeight: 1050,
          background: "#fff",
          fontFamily: "'Poppins', 'Montserrat', sans-serif",
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
          borderRadius: 8,
          padding: "36px 40px 32px 40px",
          boxSizing: "border-box",
        }}
      >
        {/* Background watermark kaaba motif - top right & bottom left */}
        <div
          style={{
            position: "absolute",
            top: -30,
            right: -30,
            width: 260,
            height: 260,
            opacity: 0.07,
            backgroundImage: "url('/logo-igh-tour.png')",
            backgroundSize: "contain",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -30,
            left: -30,
            width: 260,
            height: 260,
            opacity: 0.07,
            backgroundImage: "url('/logo-igh-tour.png')",
            backgroundSize: "contain",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
          }}
        />

        {/* Orange corner accent top-right */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 90,
            height: 90,
            background: "linear-gradient(135deg, #f97316 60%, #ea580c 100%)",
            borderRadius: "0 8px 0 80px",
          }}
        />

        {/* ── Header row ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          {/* Title */}
          <div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: "#f97316",
                lineHeight: 1.2,
                maxWidth: 380,
              }}
            >
              Penawaran Paket<br />Umroh Group 12 Hari
            </div>
          </div>
          {/* Logo */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", zIndex: 2, marginTop: 4 }}>
            <img
              src="/logo-igh-tour.png"
              alt="IGH Tour"
              style={{ width: 70, height: 70, objectFit: "contain" }}
            />
            <div style={{ fontSize: 9, color: "#888", marginTop: 2, textAlign: "center", letterSpacing: 0.5 }}>
              pilihanmu untuk menjelajah<br />timur tengah
            </div>
          </div>
        </div>

        {/* ── Date / Invoice row ── */}
        <div style={{ display: "flex", gap: 40, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 9, color: "#aaa", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Date :</div>
            <div style={{ fontSize: 11, color: "#333", fontWeight: 600 }}>06 Mei 2025</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#aaa", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Invoice :</div>
            <div style={{ fontSize: 11, color: "#333", fontWeight: 600 }}>Tante May</div>
          </div>
        </div>

        {/* ── Divider ── */}
        <div style={{ height: 1.5, background: "linear-gradient(to right, #f97316, #fed7aa, transparent)", marginBottom: 14, borderRadius: 1 }} />

        {/* ── Hotel row ── */}
        <div style={{ display: "flex", gap: 48, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 9, color: "#aaa", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Hotel Makkah</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#f97316" }}>Marwa Rotana</div>
            <div style={{ fontSize: 10, color: "#666" }}>5 Malam</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#aaa", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Hotel Madinah</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#f97316" }}>Deya Eiman</div>
            <div style={{ fontSize: 10, color: "#666" }}>5 Malam</div>
          </div>
        </div>

        {/* ── Pricing Table ── */}
        <div
          style={{
            borderRadius: 12,
            overflow: "hidden",
            border: "1.5px solid #fed7aa",
            marginBottom: 24,
          }}
        >
          {/* Table header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr",
              background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
              padding: "10px 0",
            }}
          >
            {["Total Pax", "Quad", "Triple", "Double"].map((h) => (
              <div
                key={h}
                style={{
                  textAlign: "center",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 13,
                  letterSpacing: 0.3,
                }}
              >
                {h}
              </div>
            ))}
          </div>

          {/* Table rows */}
          {PRICING.map((row, i) => (
            <div
              key={row.pax}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1fr",
                background: i % 2 === 0 ? "#fff" : "#fff7ed",
                borderTop: "1px solid #fed7aa",
                padding: "9px 0",
              }}
            >
              <div style={{ textAlign: "center", fontWeight: 700, color: "#ea580c", fontSize: 13 }}>
                {row.pax}
              </div>
              <div style={{ textAlign: "center", fontWeight: 600, color: "#374151", fontSize: 13 }}>
                {row.quad}
              </div>
              <div style={{ textAlign: "center", fontWeight: 600, color: "#374151", fontSize: 13 }}>
                {row.triple}
              </div>
              <div style={{ textAlign: "center", fontWeight: 600, color: "#374151", fontSize: 13 }}>
                {row.double}
              </div>
            </div>
          ))}
        </div>

        {/* ── Sudah / Belum Termasuk ── */}
        <div style={{ display: "flex", gap: 32, marginBottom: 24 }}>
          {/* Sudah Termasuk */}
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "inline-block",
                background: "#22c55e",
                color: "#fff",
                fontWeight: 700,
                fontSize: 11,
                borderRadius: 6,
                padding: "3px 14px",
                marginBottom: 10,
              }}
            >
              Sudah Termasuk
            </div>
            <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
              {SUDAH_TERMASUK.map((item) => (
                <li
                  key={item}
                  style={{ fontSize: 11, color: "#374151", marginBottom: 4, fontWeight: 500 }}
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Belum Termasuk */}
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "inline-block",
                background: "#f97316",
                color: "#fff",
                fontWeight: 700,
                fontSize: 11,
                borderRadius: 6,
                padding: "3px 14px",
                marginBottom: 10,
              }}
            >
              Belum Termasuk
            </div>
            <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
              {BELUM_TERMASUK.map((item) => (
                <li
                  key={item}
                  style={{ fontSize: 11, color: "#374151", marginBottom: 4, fontWeight: 500 }}
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── Footer contacts ── */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 28,
            marginBottom: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#555" }}>
            <span style={{ fontSize: 14 }}>📸</span>
            <span>instagram.com/igh.tour</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#555" }}>
            <span style={{ fontSize: 14 }}>📱</span>
            <span>+62 822-4519-3615</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#555" }}>
            <span style={{ fontSize: 14 }}>✉️</span>
            <span>igh.tours.travel@gmail.com</span>
          </div>
        </div>

        {/* ── Tagline ── */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "#aaa", marginBottom: 2 }}>Pilihanmu untuk menjelajah</div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: "#f97316",
              letterSpacing: 0.5,
            }}
          >
            Timur Tengah!
          </div>
        </div>
      </div>
    </div>
  );
}
