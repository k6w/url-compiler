/**
 * Vietnamese display renderer for voice mode (spec §15: optional localized
 * word renderer). DISPLAY-ONLY: decoding always happens on the canonical
 * ASCII English list; these words are never part of the payload contract
 * and exist purely for reading aloud. 256 unique words, one per byte.
 */
export const VOICE_WORDS_VI: readonly string[] = Object.freeze([
    "anh", "bao", "bay", "bach", "bien", "buom", "bong", "canh",
    "cay", "cam", "coa", "cau", "chen", "chieng", "chim", "chuong",
    "cua", "cuon", "den", "dien", "dinh", "do", "don", "dua",
    "duong", "ga", "gai", "gan", "gao", "ging", "goi", "goc",
    "gung", "ha", "hai", "hang", "hao", "hat", "hen", "hien",
    "hinh", "hoa", "hoang", "hon", "hut", "kha", "khe", "kho",
    "kien", "kim", "kinh", "khu", "kieu", "la", "lac", "lach",
    "lai", "lang", "lech", "lien", "long", "loi", "lua", "lung",
    "mach", "mai", "mang", "map", "me", "mich", "minh", "mo",
    "mong", "muc", "mut", "nang", "nghe", "ngoc", "nghi", "ngu",
    "nhan", "nhay", "nhat", "nhoi", "noi", "nuoc", "oc", "ong",
    "phao", "pho", "phong", "phuc", "qua", "quat", "quyen", "rang",
    "reo", "rieng", "roi", "rom", "rung", "sach", "sao", "set",
    "soi", "son", "sua", "suo", "tam", "tan", "tay", "teo",
    "thap", "thep", "thia", "thoc", "thong", "thuoc", "thuy", "tien",
    "toan", "toi", "tong", "trang", "tranh", "trong", "truc", "trung",
    "tui", "vach", "vai", "vang", "ven", "vien", "vong", "vuon",
    "xa", "xanh", "xich", "yen", "chung", "ta", "may", "ngay",
    "dem", "sang", "nha", "ban", "ghe", "giuong", "but", "tram",
    "chi", "non", "khan", "giay", "deo", "trau", "ngua", "meo",
    "vit", "tom", "hong", "hue", "lay", "sen", "cuc", "dao",
    "lan", "huong", "que", "chan", "mat", "tri", "tue", "bac",
    "dong", "nui", "song", "mua", "chuc", "vui", "deu", "moi",
    "gieng", "ao", "dan", "xom", "thi", "tran", "thanh", "khoi",
    "kiem", "cung", "mac", "buoc", "di", "ve", "nua", "nam",
    "sau", "chin", "muoi", "nghin", "trieu", "doi", "bap", "bar",
    "bat", "bas", "ben", "bep", "ber", "bet", "bec", "bes",
    "bin", "bip", "bir", "bit", "bic", "bis", "bon", "bop",
    "bor", "bot", "boc", "bos", "bun", "bup", "bur", "buc",
    "bus", "can", "cap", "car", "cat", "cac", "cas", "cen",
    "cep", "cer", "cet", "cec", "ces", "cin", "cip", "cir",
    "cit", "cic", "cis", "con", "cop", "cor", "cot", "coc",
])

export function viWord(index: number): string | undefined {
  return VOICE_WORDS_VI[index]
}
