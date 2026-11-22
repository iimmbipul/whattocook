/**
 * The default grocery catalogue shared by every household: names in English,
 * Hindi and Odia, spellings people type, a category and a default check
 * interval in days. The app admin can override or add items in Firestore
 * (`grocery_catalog`); those entries win over these defaults.
 *
 * Plain data with no imports, so both the server and the browser can use it.
 */

export const CATEGORIES = [
    'vegetables', 'fruits', 'dairy', 'meat', 'grains', 'pulses', 'spices',
    'oils', 'staples', 'condiments', 'snacks', 'bakery', 'household', 'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: unknown): value is Category {
    return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

export interface CatalogItem {
    id: string;
    en: string;
    hi: string;
    or: string;
    category: Category;
    intervalDays: number;
    /** Other spellings and words people use: pyaz, kanda, onions. */
    aliases: string[];
}

type Row = [id: string, en: string, hi: string, or: string, category: Category, intervalDays: number, aliases: string];

// prettier-ignore
const ROWS: Row[] = [
    ['onion', 'Onion', 'प्याज़', 'ପିଆଜ', 'vegetables', 3, 'pyaz,pyaaz,pyaj,kanda,onions'],
    ['tomato', 'Tomato', 'टमाटर', 'ଟମାଟୋ', 'vegetables', 2, 'tamatar,tomatoes'],
    ['potato', 'Potato', 'आलू', 'ଆଳୁ', 'vegetables', 5, 'aloo,alu,potatoes'],
    ['garlic', 'Garlic', 'लहसुन', 'ରସୁଣ', 'vegetables', 7, 'lehsun,lahsun,lasun'],
    ['ginger', 'Ginger', 'अदरक', 'ଅଦା', 'vegetables', 5, 'adrak,ada'],
    ['green_chilli', 'Green chilli', 'हरी मिर्च', 'କଞ୍ଚା ଲଙ୍କା', 'vegetables', 4, 'hari mirch,green chili,green chillies,mirchi'],
    ['coriander_leaves', 'Coriander leaves', 'हरा धनिया', 'ଧନିଆ ପତ୍ର', 'vegetables', 2, 'dhaniya patta,dhania patta,hara dhaniya,cilantro,coriander'],
    ['mint', 'Mint', 'पुदीना', 'ପୋଦିନା', 'vegetables', 3, 'pudina,mint leaves'],
    ['curry_leaves', 'Curry leaves', 'करी पत्ता', 'ଭୃସଙ୍ଗ ପତ୍ର', 'vegetables', 5, 'kadi patta,curry patta,kari patta'],
    ['lemon', 'Lemon', 'नींबू', 'ଲେମ୍ବୁ', 'vegetables', 5, 'nimbu,lime,lemons'],
    ['spinach', 'Spinach', 'पालक', 'ପାଳଙ୍ଗ ଶାଗ', 'vegetables', 2, 'palak'],
    ['cauliflower', 'Cauliflower', 'फूलगोभी', 'ଫୁଲକୋବି', 'vegetables', 3, 'gobhi,gobi,phool gobhi'],
    ['cabbage', 'Cabbage', 'पत्तागोभी', 'ବନ୍ଧାକୋବି', 'vegetables', 4, 'patta gobhi,band gobhi'],
    ['carrot', 'Carrot', 'गाजर', 'ଗାଜର', 'vegetables', 5, 'gajar,carrots'],
    ['peas', 'Green peas', 'मटर', 'ମଟର', 'vegetables', 4, 'matar,peas,green peas'],
    ['beans', 'French beans', 'बीन्स', 'ବିନ୍ସ', 'vegetables', 3, 'beans,french beans,green beans'],
    ['capsicum', 'Capsicum', 'शिमला मिर्च', 'କ୍ୟାପସିକମ୍', 'vegetables', 3, 'shimla mirch,bell pepper'],
    ['brinjal', 'Brinjal', 'बैंगन', 'ବାଇଗଣ', 'vegetables', 3, 'baingan,eggplant,aubergine'],
    ['okra', 'Okra', 'भिंडी', 'ଭେଣ୍ଡି', 'vegetables', 2, 'bhindi,lady finger,ladyfinger'],
    ['cucumber', 'Cucumber', 'खीरा', 'କାକୁଡ଼ି', 'vegetables', 3, 'kheera,khira'],
    ['bottle_gourd', 'Bottle gourd', 'लौकी', 'ଲାଉ', 'vegetables', 3, 'lauki,ghiya,dudhi'],
    ['pumpkin', 'Pumpkin', 'कद्दू', 'କଖାରୁ', 'vegetables', 5, 'kaddu,sitaphal'],
    ['mushroom', 'Mushroom', 'मशरूम', 'ଛତୁ', 'vegetables', 2, 'mushrooms'],
    ['beetroot', 'Beetroot', 'चुकंदर', 'ବିଟ୍', 'vegetables', 5, 'chukandar,beet'],
    ['radish', 'Radish', 'मूली', 'ମୂଳା', 'vegetables', 3, 'mooli'],
    ['drumstick', 'Drumstick', 'सहजन', 'ସଜନା ଛୁଇଁ', 'vegetables', 3, 'sahjan,moringa,drumsticks'],
    ['banana', 'Banana', 'केला', 'କଦଳୀ', 'fruits', 3, 'kela,bananas'],
    ['apple', 'Apple', 'सेब', 'ସେଓ', 'fruits', 5, 'seb,apples'],
    ['milk', 'Milk', 'दूध', 'ଦୁଧ', 'dairy', 1, 'doodh,dudh'],
    ['curd', 'Curd', 'दही', 'ଦହି', 'dairy', 2, 'dahi,yogurt,yoghurt'],
    ['paneer', 'Paneer', 'पनीर', 'ପନିର', 'dairy', 3, 'cottage cheese'],
    ['butter', 'Butter', 'मक्खन', 'ବଟର', 'dairy', 7, 'makhan,makkhan'],
    ['ghee', 'Ghee', 'घी', 'ଘିଅ', 'dairy', 14, 'ghi,desi ghee'],
    ['cream', 'Fresh cream', 'क्रीम', 'କ୍ରିମ୍', 'dairy', 5, 'malai,cream'],
    ['cheese', 'Cheese', 'चीज़', 'ଚିଜ୍', 'dairy', 7, 'cheese slices'],
    ['eggs', 'Eggs', 'अंडे', 'ଅଣ୍ଡା', 'dairy', 4, 'egg,anda,ande'],
    ['chicken', 'Chicken', 'चिकन', 'ଚିକେନ୍', 'meat', 2, 'murgi,murga'],
    ['fish', 'Fish', 'मछली', 'ମାଛ', 'meat', 2, 'machli,machhli,macha'],
    ['mutton', 'Mutton', 'मटन', 'ମାଂସ', 'meat', 3, 'gosht,goat meat'],
    ['rice', 'Rice', 'चावल', 'ଚାଉଳ', 'grains', 10, 'chawal,basmati,basmati rice'],
    ['atta', 'Wheat flour (atta)', 'आटा', 'ଅଟା', 'grains', 7, 'atta,aata,wheat flour,whole wheat flour,gehun ka atta'],
    ['maida', 'Maida', 'मैदा', 'ମଇଦା', 'grains', 14, 'refined flour,all purpose flour'],
    ['besan', 'Besan', 'बेसन', 'ବେସନ', 'grains', 14, 'gram flour,chickpea flour'],
    ['suji', 'Suji (rava)', 'सूजी', 'ସୁଜି', 'grains', 14, 'suji,sooji,rava,rawa,semolina'],
    ['poha', 'Poha', 'पोहा', 'ଚୁଡ଼ା', 'grains', 14, 'flattened rice,chiwda,chuda'],
    ['oats', 'Oats', 'ओट्स', 'ଓଟ୍ସ', 'grains', 14, 'oatmeal'],
    ['vermicelli', 'Vermicelli', 'सेवई', 'ସେମେଇ', 'grains', 14, 'seviyan,sevai,semiya'],
    ['sabudana', 'Sabudana', 'साबूदाना', 'ସାଗୁ', 'grains', 21, 'sago,tapioca pearls'],
    ['idli_batter', 'Idli/dosa batter', 'इडली डोसा बैटर', 'ଇଡ଼ଲି ବାଟା', 'grains', 2, 'idli batter,dosa batter'],
    ['toor_dal', 'Toor dal', 'अरहर दाल', 'ହରଡ଼ ଡାଲି', 'pulses', 10, 'arhar dal,tur dal,toor,pigeon pea'],
    ['moong_dal', 'Moong dal', 'मूंग दाल', 'ମୁଗ ଡାଲି', 'pulses', 10, 'moong,mung dal,green gram'],
    ['masoor_dal', 'Masoor dal', 'मसूर दाल', 'ମସୁର ଡାଲି', 'pulses', 10, 'masoor,red lentils,lentils'],
    ['chana_dal', 'Chana dal', 'चना दाल', 'ବୁଟ ଡାଲି', 'pulses', 14, 'chana daal,bengal gram'],
    ['urad_dal', 'Urad dal', 'उड़द दाल', 'ବିରି ଡାଲି', 'pulses', 14, 'urad,black gram,biri'],
    ['rajma', 'Rajma', 'राजमा', 'ରାଜମା', 'pulses', 14, 'kidney beans,red kidney beans'],
    ['chickpeas', 'Chickpeas (chole)', 'काबुली चना', 'କାବୁଲି ବୁଟ', 'pulses', 14, 'chole,chhole,kabuli chana,chickpea,garbanzo'],
    ['kala_chana', 'Black chana', 'काला चना', 'କଳା ବୁଟ', 'pulses', 21, 'kala chana,black chickpeas'],
    ['soya_chunks', 'Soya chunks', 'सोया चंक्स', 'ସୋୟାବିନ୍', 'pulses', 21, 'soya,soyabean chunks,nutrela'],
    ['salt', 'Salt', 'नमक', 'ଲୁଣ', 'staples', 21, 'namak'],
    ['sugar', 'Sugar', 'चीनी', 'ଚିନି', 'staples', 10, 'cheeni,chini,shakkar'],
    ['jaggery', 'Jaggery', 'गुड़', 'ଗୁଡ଼', 'staples', 21, 'gud,gur'],
    ['tea', 'Tea leaves', 'चाय पत्ती', 'ଚା ପତ୍ର', 'staples', 10, 'chai patti,tea,chai,chaipatti'],
    ['coffee', 'Coffee', 'कॉफ़ी', 'କଫି', 'staples', 21, 'coffee powder'],
    ['turmeric', 'Turmeric', 'हल्दी', 'ହଳଦୀ', 'spices', 14, 'haldi,turmeric powder'],
    ['chilli_powder', 'Red chilli powder', 'लाल मिर्च पाउडर', 'ଲଙ୍କା ଗୁଣ୍ଡ', 'spices', 14, 'lal mirch powder,chilli powder,red chili powder,mirchi powder'],
    ['dry_red_chilli', 'Dry red chilli', 'सूखी लाल मिर्च', 'ଶୁଖିଲା ଲଙ୍କା', 'spices', 30, 'sukhi lal mirch,sukhi mirch,sabut lal mirch,whole red chilli,dried red chilli,lal mirch'],
    ['coriander_powder', 'Coriander powder', 'धनिया पाउडर', 'ଧନିଆ ଗୁଣ୍ଡ', 'spices', 14, 'dhaniya powder,dhania powder'],
    ['cumin', 'Cumin', 'जीरा', 'ଜିରା', 'spices', 21, 'jeera,zeera,cumin seeds'],
    ['mustard_seeds', 'Mustard seeds', 'राई', 'ସୋରିଷ', 'spices', 21, 'rai,sarson,mustard'],
    ['garam_masala', 'Garam masala', 'गरम मसाला', 'ଗରମ ମସଲା', 'spices', 21, 'garam masala powder'],
    ['hing', 'Hing', 'हींग', 'ହେଙ୍ଗୁ', 'spices', 30, 'asafoetida'],
    ['black_pepper', 'Black pepper', 'काली मिर्च', 'ଗୋଲମରିଚ', 'spices', 30, 'kali mirch,pepper'],
    ['cardamom', 'Cardamom', 'इलायची', 'ଅଳେଇଚ', 'spices', 30, 'elaichi'],
    ['cloves', 'Cloves', 'लौंग', 'ଲବଙ୍ଗ', 'spices', 30, 'laung'],
    ['cinnamon', 'Cinnamon', 'दालचीनी', 'ଡାଲଚିନି', 'spices', 30, 'dalchini'],
    ['bay_leaf', 'Bay leaf', 'तेज पत्ता', 'ତେଜପତ୍ର', 'spices', 30, 'tej patta,tejpatta'],
    ['fenugreek_seeds', 'Fenugreek seeds', 'मेथी दाना', 'ମେଥି', 'spices', 30, 'methi dana,methi seeds'],
    ['kasuri_methi', 'Kasuri methi', 'कसूरी मेथी', 'କସୁରି ମେଥି', 'spices', 30, 'dried fenugreek leaves'],
    ['ajwain', 'Ajwain', 'अजवाइन', 'ଜୁଆଣି', 'spices', 30, 'carom seeds'],
    ['chaat_masala', 'Chaat masala', 'चाट मसाला', 'ଚାଟ୍ ମସଲା', 'spices', 30, 'chat masala'],
    ['sambar_powder', 'Sambar powder', 'सांभर मसाला', 'ସାମ୍ବର ମସଲା', 'spices', 21, 'sambar masala'],
    ['chole_masala', 'Chole masala', 'छोले मसाला', 'ଛୋଲେ ମସଲା', 'spices', 30, 'chana masala powder'],
    ['mustard_oil', 'Mustard oil', 'सरसों का तेल', 'ସୋରିଷ ତେଲ', 'oils', 14, 'sarson tel,sarson ka tel,kachi ghani'],
    ['cooking_oil', 'Cooking oil', 'रिफाइंड तेल', 'ରିଫାଇନ୍ ତେଲ', 'oils', 14, 'refined oil,oil,sunflower oil,vegetable oil,tel'],
    ['olive_oil', 'Olive oil', 'ऑलिव ऑयल', 'ଅଲିଭ୍ ତେଲ', 'oils', 30, 'olive oil'],
    ['coconut_oil', 'Coconut oil', 'नारियल तेल', 'ନଡ଼ିଆ ତେଲ', 'oils', 30, 'nariyal tel'],
    ['tamarind', 'Tamarind', 'इमली', 'ତେନ୍ତୁଳି', 'condiments', 21, 'imli'],
    ['coconut', 'Coconut', 'नारियल', 'ନଡ଼ିଆ', 'condiments', 5, 'nariyal,grated coconut'],
    ['ketchup', 'Tomato ketchup', 'टोमैटो केचप', 'ଟମାଟୋ ସସ୍', 'condiments', 21, 'ketchup,tomato sauce'],
    ['pickle', 'Pickle', 'अचार', 'ଆଚାର', 'condiments', 30, 'achar,aachar'],
    ['vinegar', 'Vinegar', 'सिरका', 'ଭିନେଗାର', 'condiments', 30, 'sirka'],
    ['soy_sauce', 'Soy sauce', 'सोया सॉस', 'ସୋୟା ସସ୍', 'condiments', 30, 'soya sauce'],
    ['honey', 'Honey', 'शहद', 'ମହୁ', 'condiments', 30, 'shahad'],
    ['peanuts', 'Peanuts', 'मूंगफली', 'ଚିନାବାଦାମ', 'snacks', 21, 'moongphali,groundnut,groundnuts'],
    ['cashews', 'Cashews', 'काजू', 'କାଜୁ', 'snacks', 30, 'kaju,cashew'],
    ['almonds', 'Almonds', 'बादाम', 'ବାଦାମ', 'snacks', 30, 'badam,almond'],
    ['raisins', 'Raisins', 'किशमिश', 'କିସମିସ', 'snacks', 30, 'kishmish'],
    ['bread', 'Bread', 'ब्रेड', 'ପାଉଁରୁଟି', 'bakery', 2, 'pav,pao,double roti'],
    ['biscuits', 'Biscuits', 'बिस्कुट', 'ବିସ୍କୁଟ', 'bakery', 7, 'biscuit,cookies'],
    ['dishwash', 'Dishwash liquid', 'बर्तन धोने का लिक्विड', 'ବାସନ ଧୁଆ ଲିକୁଇଡ୍', 'household', 21, 'vim,dish soap,bartan sabun,dishwash bar'],
    ['lpg', 'Gas cylinder', 'गैस सिलेंडर', 'ଗ୍ୟାସ୍ ସିଲିଣ୍ଡର', 'household', 30, 'gas,cylinder,lpg'],
];

export const DEFAULT_CATALOG: CatalogItem[] = ROWS.map(([id, en, hi, or, category, intervalDays, aliases]) => ({
    id,
    en,
    hi,
    or,
    category,
    intervalDays,
    aliases: aliases.split(',').map(a => a.trim()).filter(Boolean),
}));

/** Every name and spelling an item is known by, for matching typed words. */
export function itemTerms(item: Pick<CatalogItem, 'en' | 'hi' | 'or' | 'aliases'>): string[] {
    return [item.en, item.hi, item.or, ...item.aliases].filter(Boolean);
}

/** The item's name in the viewer's language, falling back to English. */
export function localName(item: { en: string; hi?: string; or?: string }, locale: string): string {
    if (locale === 'hi' && item.hi) return item.hi;
    if (locale === 'or' && item.or) return item.or;
    return item.en;
}
