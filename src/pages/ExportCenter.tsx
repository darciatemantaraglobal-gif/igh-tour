import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Users, Plane, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTripsStore } from "@/store/tripsStore";
import { listJamaah, type Jamaah } from "@/features/trips/tripsRepo";
import { toast } from "sonner";

export default function ExportCenter() {
  const trips = useTripsStore((s) => s.trips);
  const fetchTrips = useTripsStore((s) => s.fetchTrips);
  const [tripId, setTripId] = useState<string>("");
  const [jamaah, setJamaah] = useState<Jamaah[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<"rooming" | "manifest" | null>(null);

  useEffect(() => { fetchTrips(); }, [fetchTrips]);
  useEffect(() => {
    if (!tripId) { setJamaah([]); return; }
    setLoading(true);
    listJamaah(tripId)
      .then((data) => setJamaah(data))
      .catch(() => toast.error("Gagal memuat data jamaah."))
      .finally(() => setLoading(false));
  }, [tripId]);

  const trip = useMemo(() => trips.find((t) => t.id === tripId), [trips, tripId]);
  const safeName = (s: string) => s.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 40);

  const exportRoomingList = async () => {
    if (!trip || jamaah.length === 0) return;
    setExporting("rooming");
    try {
      const XLSX = await import("xlsx");
      const rows = [...jamaah].sort((a, b) => {
        if (a.gender !== b.gender) return (a.gender || "Z").localeCompare(b.gender || "Z");
        return a.name.localeCompare(b.name);
      });
      let roomNo = 0;
      const data = rows.map((j, idx) => {
        if (idx % 2 === 0) roomNo++;
        return {
          No: idx + 1,
          "Kamar": `K-${String(roomNo).padStart(3, "0")}`,
          "Nama Jamaah": j.name,
          "Gender": j.gender === "L" ? "Laki-laki" : j.gender === "P" ? "Perempuan" : "-",
          "No. Paspor": j.passportNumber || "-",
          "No. HP": j.phone || "-",
          "Tgl Lahir": j.birthDate || "-",
        };
      });
      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = [{ wch: 4 }, { wch: 8 }, { wch: 30 }, { wch: 11 }, { wch: 14 }, { wch: 16 }, { wch: 12 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Rooming List");
      XLSX.writeFile(wb, `RoomingList_${safeName(trip.name)}.xlsx`);
      toast.success("Rooming list berhasil di-export.");
    } catch {
      toast.error("Export gagal.");
    } finally {
      setExporting(null);
    }
  };

  const exportFlightManifest = async () => {
    if (!trip || jamaah.length === 0) return;
    setExporting("manifest");
    try {
      const XLSX = await import("xlsx");
      const data = jamaah.map((j, idx) => ({
        No: idx + 1,
        "Nama Lengkap (sesuai paspor)": j.name,
        "Gender": j.gender === "L" ? "M" : j.gender === "P" ? "F" : "-",
        "Tgl Lahir": j.birthDate || "-",
        "No. Paspor": j.passportNumber || "-",
        "No. HP": j.phone || "-",
        "Status Review": j.needsReview ? "PERLU REVIEW" : "OK",
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = [{ wch: 4 }, { wch: 32 }, { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Flight Manifest");
      XLSX.writeFile(wb, `FlightManifest_${safeName(trip.name)}.xlsx`);
      toast.success("Flight manifest berhasil di-export.");
    } catch {
      toast.error("Export gagal.");
    } finally {
      setExporting(null);
    }
  };

  const needReviewCount = jamaah.filter((j) => j.needsReview).length;

  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileSpreadsheet className="h-6 w-6 text-primary" />
          Export Center
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate file Excel untuk Rooming List & Flight Manifest per trip.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pilih Trip</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={tripId} onValueChange={setTripId}>
            <SelectTrigger data-testid="select-trip"><SelectValue placeholder="Pilih trip…" /></SelectTrigger>
            <SelectContent>
              {trips.length === 0 ? (
                <SelectItem value="__none" disabled>Belum ada trip.</SelectItem>
              ) : (
                trips.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.emoji} {t.name} — {t.destination}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>

          {tripId && (
            <div className="rounded-lg bg-muted/40 p-3 text-sm flex items-center justify-between">
              {loading ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Memuat jamaah…
                </span>
              ) : (
                <>
                  <span><strong>{jamaah.length}</strong> jamaah terdaftar</span>
                  {needReviewCount > 0 && (
                    <span className="text-amber-700 font-medium">
                      ⚠ {needReviewCount} perlu review
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-500" /> Rooming List
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Daftar pembagian kamar (2 jamaah/kamar), dipisah per gender.
            </p>
            <Button
              onClick={exportRoomingList}
              disabled={!tripId || jamaah.length === 0 || loading || exporting !== null}
              className="w-full"
              data-testid="btn-export-rooming"
            >
              {exporting === "rooming" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Generate Excel
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plane className="h-5 w-5 text-emerald-500" /> Flight Manifest
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Detail paspor & data penerbangan untuk maskapai/agen visa.
            </p>
            <Button
              onClick={exportFlightManifest}
              disabled={!tripId || jamaah.length === 0 || loading || exporting !== null}
              className="w-full"
              data-testid="btn-export-manifest"
            >
              {exporting === "manifest" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Generate Excel
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
