export type Lang = "id" | "en" | "ar";

export interface Translations {
  // Navigation
  nav_dashboard: string;
  nav_calculator: string;
  nav_packages: string;
  nav_progress: string;
  nav_pdf: string;
  nav_notes: string;
  nav_exports?: string;
  nav_settings: string;
  nav_logout: string;
  nav_group_operational: string;
  nav_group_tools: string;

  // Dashboard
  greeting_early_morning: string;
  greeting_morning: string;
  greeting_day: string;
  greeting_afternoon: string;
  greeting_evening: string;
  dash_nearest_departure: string;
  dash_no_schedule: string;
  dash_total_trip: string;
  dash_active_trip: string;
  dash_done_trip: string;
  dash_total_jamaah: string;
  dash_total_packages: string;
  dash_need_action: string;
  dash_paid_packages: string;
  dash_completed_packages: string;
  dash_needs_attention: string;
  dash_view_all: string;
  dash_filter_all: string;
  dash_filter_active: string;
  dash_filter_done: string;
  dash_packages_title: string;
  dash_open_calculator: string;
  dash_progress_report: string;
  dash_add_package: string;
  dash_no_packages: string;
  dash_no_packages_desc: string;
  dash_create_first: string;
  dash_more_packages: string;
  dash_delete_title: string;
  dash_delete_desc: string;

  // Common buttons
  btn_save: string;
  btn_cancel: string;
  btn_add: string;
  btn_delete: string;
  btn_edit: string;
  btn_close: string;
  btn_confirm: string;

  // Notes
  notes_title: string;
  notes_saved_count: string;
  notes_new_btn: string;
  notes_close_btn: string;
  notes_label_new: string;
  notes_placeholder_title: string;
  notes_placeholder_content: string;
  notes_add_tag: string;
  notes_color: string;
  notes_new_tag: string;
  notes_sort_newest: string;
  notes_sort_oldest: string;
  notes_sort_az: string;
  notes_search: string;
  notes_filter_all: string;
  notes_empty: string;
  notes_first_note: string;
  notes_not_found: string;
  notes_pin: string;
  notes_unpin: string;
  notes_expand: string;
  notes_copy: string;
  notes_clean: string;
  notes_words: string;
  notes_chars: string;
  notes_ctrl_enter: string;
  notes_no_content: string;
  notes_empty_label: string;
  notes_cancel: string;
  notes_save: string;

  // Status labels
  status_draft: string;
  status_calculated: string;
  status_confirmed: string;
  status_paid: string;
  status_completed: string;

  // Settings tabs
  settings_profile: string;
  settings_notifications: string;
  settings_security: string;
  settings_appearance: string;
  settings_regional: string;
  settings_rates: string;
  settings_agents: string;

  // Settings - Regional section
  settings_regional_desc: string;
  settings_regional_lang: string;
  settings_regional_tz: string;
  settings_regional_currency: string;
  settings_regional_date: string;
  settings_regional_updated: string;
  settings_regional_updated_desc: string;
  settings_regional_preview: string;
  settings_regional_number: string;
  settings_regional_date_label: string;
}

const id: Translations = {
  nav_dashboard: "Dashboard",
  nav_calculator: "Kalkulator",
  nav_packages: "Paket Trip",
  nav_progress: "Progress",
  nav_pdf: "Generator PDF",
  nav_notes: "Catatan",
  nav_settings: "Pengaturan",
  nav_logout: "Logout",
  nav_group_operational: "Operasional",
  nav_group_tools: "Tools",

  greeting_early_morning: "Selamat Malam",
  greeting_morning: "Selamat Pagi",
  greeting_day: "Selamat Siang",
  greeting_afternoon: "Selamat Sore",
  greeting_evening: "Selamat Malam",
  dash_nearest_departure: "Keberangkatan terdekat:",
  dash_no_schedule: "Belum ada jadwal keberangkatan paket.",
  dash_total_trip: "Total Trip",
  dash_active_trip: "Trip Aktif",
  dash_done_trip: "Selesai",
  dash_total_jamaah: "Total Jamaah",
  dash_total_packages: "Total Paket",
  dash_need_action: "Perlu Aksi",
  dash_paid_packages: "Paket Lunas",
  dash_completed_packages: "Paket Selesai",
  dash_needs_attention: "Paket Belum Selesai",
  dash_view_all: "Lihat semua",
  dash_filter_all: "Semua",
  dash_filter_active: "Aktif",
  dash_filter_done: "Selesai",
  dash_packages_title: "Paket Trip",
  dash_open_calculator: "Buka Kalkulator",
  dash_progress_report: "Laporan Progress",
  dash_add_package: "Tambah Paket",
  dash_no_packages: "Belum ada paket trip",
  dash_no_packages_desc: "Buat paket perjalanan pertama kamu di halaman Paket Trip.",
  dash_create_first: "Buat Paket Pertama",
  dash_more_packages: "paket lainnya",
  dash_delete_title: "Hapus Paket Trip?",
  dash_delete_desc: "dan semua data jamaah di dalamnya akan dihapus permanen.",

  btn_save: "Simpan",
  btn_cancel: "Batal",
  btn_add: "Tambah",
  btn_delete: "Hapus",
  btn_edit: "Edit",
  btn_close: "Tutup",
  btn_confirm: "Konfirmasi",

  notes_title: "Catatan",
  notes_saved_count: "catatan tersimpan",
  notes_new_btn: "Tambah",
  notes_close_btn: "Tutup",
  notes_label_new: "Catatan Baru",
  notes_placeholder_title: "Judul catatan…",
  notes_placeholder_content: "Tulis isi catatan di sini…",
  notes_add_tag: "Tambah tag, Enter",
  notes_color: "Warna:",
  notes_new_tag: "Tag baru",
  notes_sort_newest: "Terbaru",
  notes_sort_oldest: "Lama",
  notes_sort_az: "A-Z",
  notes_search: "Cari catatan…",
  notes_filter_all: "Semua",
  notes_empty: "Belum ada catatan.",
  notes_first_note: "+ Buat catatan pertama",
  notes_not_found: "Catatan tidak ditemukan.",
  notes_pin: "Pin catatan",
  notes_unpin: "Lepas pin",
  notes_expand: "Perbesar",
  notes_copy: "Salin",
  notes_clean: "Rapihkan",
  notes_words: "kata",
  notes_chars: "karakter",
  notes_ctrl_enter: "Ctrl+Enter untuk simpan",
  notes_no_content: "Tidak ada isi catatan.",
  notes_empty_label: "Kosong",
  notes_cancel: "Batal",
  notes_save: "Simpan",

  status_draft: "Draft",
  status_calculated: "Dihitung",
  status_confirmed: "Dikonfirmasi",
  status_paid: "Lunas",
  status_completed: "Selesai",

  settings_profile: "Profil",
  settings_notifications: "Notifikasi",
  settings_security: "Keamanan",
  settings_appearance: "Tampilan",
  settings_regional: "Regional",
  settings_rates: "Kurs",
  settings_agents: "Agen",

  settings_regional_desc: "Pengaturan bahasa, zona waktu, mata uang, dan format tanggal — diterapkan otomatis ke seluruh aplikasi",
  settings_regional_lang: "Bahasa",
  settings_regional_tz: "Zona Waktu",
  settings_regional_currency: "Mata Uang Default",
  settings_regional_date: "Format Tanggal",
  settings_regional_updated: "Pengaturan regional diperbarui",
  settings_regional_updated_desc: "Perubahan langsung diterapkan ke seluruh aplikasi.",
  settings_regional_preview: "Preview Format Aktif",
  settings_regional_number: "Angka / Mata Uang",
  settings_regional_date_label: "Tanggal",
};

const en: Translations = {
  nav_dashboard: "Dashboard",
  nav_calculator: "Calculator",
  nav_packages: "Trip Packages",
  nav_progress: "Progress",
  nav_pdf: "PDF Generator",
  nav_notes: "Notes",
  nav_settings: "Settings",
  nav_logout: "Logout",
  nav_group_operational: "Operations",
  nav_group_tools: "Tools",

  greeting_early_morning: "Good Night",
  greeting_morning: "Good Morning",
  greeting_day: "Good Day",
  greeting_afternoon: "Good Afternoon",
  greeting_evening: "Good Evening",
  dash_nearest_departure: "Nearest departure:",
  dash_no_schedule: "No departure schedule yet.",
  dash_total_trip: "Total Trips",
  dash_active_trip: "Active Trips",
  dash_done_trip: "Completed",
  dash_total_jamaah: "Total Pilgrims",
  dash_total_packages: "Total Packages",
  dash_need_action: "Needs Action",
  dash_paid_packages: "Paid Packages",
  dash_completed_packages: "Completed Packages",
  dash_needs_attention: "Pending Packages",
  dash_view_all: "View all",
  dash_filter_all: "All",
  dash_filter_active: "Active",
  dash_filter_done: "Done",
  dash_packages_title: "Trip Packages",
  dash_open_calculator: "Open Calculator",
  dash_progress_report: "Progress Report",
  dash_add_package: "Add Package",
  dash_no_packages: "No trip packages yet",
  dash_no_packages_desc: "Create your first travel package on the Packages page.",
  dash_create_first: "Create First Package",
  dash_more_packages: "more packages",
  dash_delete_title: "Delete Trip Package?",
  dash_delete_desc: "and all pilgrim data within it will be permanently deleted.",

  btn_save: "Save",
  btn_cancel: "Cancel",
  btn_add: "Add",
  btn_delete: "Delete",
  btn_edit: "Edit",
  btn_close: "Close",
  btn_confirm: "Confirm",

  notes_title: "Notes",
  notes_saved_count: "notes saved",
  notes_new_btn: "Add",
  notes_close_btn: "Close",
  notes_label_new: "New Note",
  notes_placeholder_title: "Note title…",
  notes_placeholder_content: "Write note content here…",
  notes_add_tag: "Add tag, Enter",
  notes_color: "Color:",
  notes_new_tag: "New tag",
  notes_sort_newest: "Newest",
  notes_sort_oldest: "Oldest",
  notes_sort_az: "A-Z",
  notes_search: "Search notes…",
  notes_filter_all: "All",
  notes_empty: "No notes yet.",
  notes_first_note: "+ Create your first note",
  notes_not_found: "No notes found.",
  notes_pin: "Pin note",
  notes_unpin: "Unpin",
  notes_expand: "Expand",
  notes_copy: "Copy",
  notes_clean: "Clean up",
  notes_words: "words",
  notes_chars: "characters",
  notes_ctrl_enter: "Ctrl+Enter to save",
  notes_no_content: "No content.",
  notes_empty_label: "Empty",
  notes_cancel: "Cancel",
  notes_save: "Save",

  status_draft: "Draft",
  status_calculated: "Calculated",
  status_confirmed: "Confirmed",
  status_paid: "Paid",
  status_completed: "Completed",

  settings_profile: "Profile",
  settings_notifications: "Notifications",
  settings_security: "Security",
  settings_appearance: "Appearance",
  settings_regional: "Regional",
  settings_rates: "Rates",
  settings_agents: "Agents",

  settings_regional_desc: "Language, timezone, currency, and date format settings — applied automatically across the app",
  settings_regional_lang: "Language",
  settings_regional_tz: "Timezone",
  settings_regional_currency: "Default Currency",
  settings_regional_date: "Date Format",
  settings_regional_updated: "Regional settings updated",
  settings_regional_updated_desc: "Changes applied across the app immediately.",
  settings_regional_preview: "Active Format Preview",
  settings_regional_number: "Number / Currency",
  settings_regional_date_label: "Date",
};

const ar: Translations = {
  nav_dashboard: "لوحة التحكم",
  nav_calculator: "الحاسبة",
  nav_packages: "باقات السفر",
  nav_progress: "التقدم",
  nav_pdf: "مولد PDF",
  nav_notes: "ملاحظات",
  nav_settings: "الإعدادات",
  nav_logout: "خروج",
  nav_group_operational: "العمليات",
  nav_group_tools: "الأدوات",

  greeting_early_morning: "تصبح على خير",
  greeting_morning: "صباح الخير",
  greeting_day: "مرحباً",
  greeting_afternoon: "مساء الخير",
  greeting_evening: "مساء الخير",
  dash_nearest_departure: "أقرب رحلة:",
  dash_no_schedule: "لا يوجد جدول مغادرة بعد.",
  dash_total_trip: "إجمالي الرحلات",
  dash_active_trip: "رحلات نشطة",
  dash_done_trip: "مكتملة",
  dash_total_jamaah: "إجمالي الحجاج",
  dash_total_packages: "إجمالي الباقات",
  dash_need_action: "يحتاج إجراء",
  dash_paid_packages: "باقات مدفوعة",
  dash_completed_packages: "باقات مكتملة",
  dash_needs_attention: "باقات معلقة",
  dash_view_all: "عرض الكل",
  dash_filter_all: "الكل",
  dash_filter_active: "نشطة",
  dash_filter_done: "مكتملة",
  dash_packages_title: "باقات السفر",
  dash_open_calculator: "فتح الحاسبة",
  dash_progress_report: "تقرير التقدم",
  dash_add_package: "إضافة باقة",
  dash_no_packages: "لا توجد باقات سفر بعد",
  dash_no_packages_desc: "أنشئ أول باقة سفر من صفحة الباقات.",
  dash_create_first: "إنشاء أول باقة",
  dash_more_packages: "باقة أخرى",
  dash_delete_title: "حذف باقة السفر؟",
  dash_delete_desc: "وجميع بيانات الحجاج بداخلها ستُحذف نهائياً.",

  btn_save: "حفظ",
  btn_cancel: "إلغاء",
  btn_add: "إضافة",
  btn_delete: "حذف",
  btn_edit: "تعديل",
  btn_close: "إغلاق",
  btn_confirm: "تأكيد",

  notes_title: "ملاحظات",
  notes_saved_count: "ملاحظة محفوظة",
  notes_new_btn: "إضافة",
  notes_close_btn: "إغلاق",
  notes_label_new: "ملاحظة جديدة",
  notes_placeholder_title: "عنوان الملاحظة…",
  notes_placeholder_content: "اكتب محتوى الملاحظة هنا…",
  notes_add_tag: "أضف وسماً، Enter",
  notes_color: "اللون:",
  notes_new_tag: "وسم جديد",
  notes_sort_newest: "الأحدث",
  notes_sort_oldest: "الأقدم",
  notes_sort_az: "أ-ي",
  notes_search: "بحث في الملاحظات…",
  notes_filter_all: "الكل",
  notes_empty: "لا توجد ملاحظات بعد.",
  notes_first_note: "+ إنشاء أول ملاحظة",
  notes_not_found: "لا توجد ملاحظات.",
  notes_pin: "تثبيت",
  notes_unpin: "إلغاء التثبيت",
  notes_expand: "توسيع",
  notes_copy: "نسخ",
  notes_clean: "تنظيم",
  notes_words: "كلمة",
  notes_chars: "حرف",
  notes_ctrl_enter: "Ctrl+Enter للحفظ",
  notes_no_content: "لا يوجد محتوى.",
  notes_empty_label: "فارغ",
  notes_cancel: "إلغاء",
  notes_save: "حفظ",

  status_draft: "مسودة",
  status_calculated: "محسوب",
  status_confirmed: "مؤكد",
  status_paid: "مدفوع",
  status_completed: "مكتمل",

  settings_profile: "الملف الشخصي",
  settings_notifications: "الإشعارات",
  settings_security: "الأمان",
  settings_appearance: "المظهر",
  settings_regional: "الإقليمية",
  settings_rates: "أسعار الصرف",
  settings_agents: "الوكلاء",

  settings_regional_desc: "إعدادات اللغة والمنطقة الزمنية والعملة وتنسيق التاريخ — تُطبق تلقائياً في كل التطبيق",
  settings_regional_lang: "اللغة",
  settings_regional_tz: "المنطقة الزمنية",
  settings_regional_currency: "العملة الافتراضية",
  settings_regional_date: "تنسيق التاريخ",
  settings_regional_updated: "تم تحديث الإعدادات الإقليمية",
  settings_regional_updated_desc: "التغييرات طُبِّقت فوراً في كل التطبيق.",
  settings_regional_preview: "معاينة التنسيق الحالي",
  settings_regional_number: "الأرقام / العملة",
  settings_regional_date_label: "التاريخ",
};

const dict: Record<Lang, Translations> = { id, en, ar };

export function getT(lang: Lang): Translations {
  return dict[lang] ?? dict.id;
}
