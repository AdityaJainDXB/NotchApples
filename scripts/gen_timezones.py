#!/usr/bin/env python3
"""Builds the World Clock place list for Mac and Windows from the system's zone.tab
(every country and every region inside a country with its own time) plus well-known
cities, states and provinces that share a zone with another city.

  python3 scripts/gen_timezones.py
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAB = '/usr/share/zoneinfo'

countries = {}
for line in open(f'{TAB}/iso3166.tab', encoding='utf-8'):
    if line.startswith('#') or not line.strip(): continue
    code, name = line.rstrip('\n').split('\t')[:2]
    countries[code] = name

places = []  # [name, zone, detail]
for line in open(f'{TAB}/zone.tab', encoding='utf-8'):
    if line.startswith('#') or not line.strip(): continue
    parts = line.rstrip('\n').split('\t')
    code, zone = parts[0], parts[2]
    note = parts[3] if len(parts) > 3 else ''
    city = zone.split('/')[-1].replace('_', ' ')
    country = countries.get(code, code)
    places.append([city, zone, f'{country} · {note}' if note else country])

# Well-known places whose time zone is named after a different city.
EXTRA = {
    'Asia/Kolkata': 'India: Mumbai, New Delhi, Delhi, Bangalore, Bengaluru, Chennai, Hyderabad, Pune, Ahmedabad, Jaipur, Goa',
    'Asia/Shanghai': 'China: Beijing, Shenzhen, Guangzhou, Chengdu, Wuhan, Hangzhou',
    'Asia/Hong_Kong': 'Hong Kong',
    'Asia/Dubai': 'United Arab Emirates: Abu Dhabi, Sharjah, Ajman, Ras Al Khaimah, Fujairah',
    'Asia/Riyadh': 'Saudi Arabia: Jeddah, Mecca, Medina, Dammam',
    'Asia/Karachi': 'Pakistan: Lahore, Islamabad, Rawalpindi, Faisalabad',
    'Asia/Dhaka': 'Bangladesh: Chittagong',
    'Asia/Tokyo': 'Japan: Osaka, Kyoto, Yokohama, Nagoya, Sapporo, Fukuoka',
    'Asia/Seoul': 'South Korea: Busan, Incheon',
    'Asia/Jakarta': 'Indonesia (West): Bandung, Surabaya, Java, Sumatra',
    'Asia/Makassar': 'Indonesia (Central): Bali, Denpasar',
    'Asia/Manila': 'Philippines: Cebu, Quezon City',
    'Asia/Ho_Chi_Minh': 'Vietnam: Hanoi, Saigon, Da Nang',
    'Asia/Bangkok': 'Thailand: Phuket, Chiang Mai, Pattaya',
    'Asia/Kuala_Lumpur': 'Malaysia: Penang',
    'Asia/Jerusalem': 'Israel: Tel Aviv, Haifa',
    'Asia/Tehran': 'Iran: Isfahan, Mashhad',
    'Asia/Kathmandu': 'Nepal: Pokhara',
    'Asia/Yangon': 'Myanmar: Rangoon, Mandalay',
    'Europe/Istanbul': 'Turkey: Ankara, Izmir, Antalya',
    'Europe/Moscow': 'Russia (Moscow time): Saint Petersburg, St Petersburg, Kazan, Nizhny Novgorod',
    'Europe/London': 'United Kingdom: England, Scotland, Wales, Northern Ireland, Manchester, Birmingham, Edinburgh, Glasgow, Liverpool, Belfast',
    'Europe/Paris': 'France: Lyon, Marseille, Nice, Toulouse',
    'Europe/Berlin': 'Germany: Munich, Frankfurt, Hamburg, Cologne, Stuttgart',
    'Europe/Madrid': 'Spain (mainland): Barcelona, Valencia, Seville, Malaga',
    'Atlantic/Canary': 'Spain: Canary Islands, Tenerife, Gran Canaria, Las Palmas',
    'Europe/Rome': 'Italy: Milan, Naples, Florence, Venice, Turin',
    'Europe/Amsterdam': 'Netherlands: Rotterdam, The Hague, Utrecht',
    'Europe/Zurich': 'Switzerland: Geneva, Bern, Basel',
    'Europe/Kyiv': 'Ukraine: Kiev, Odesa, Lviv, Kharkiv',
    'America/New_York': 'USA Eastern: New York City, NYC, Washington DC, Boston, Philadelphia, Atlanta, Miami, Orlando, Charlotte, Pittsburgh, Florida, Georgia, Virginia, North Carolina, South Carolina, Ohio, Pennsylvania, New Jersey, Massachusetts, Maryland, Connecticut, Maine, Vermont, New Hampshire, Rhode Island, Delaware, West Virginia, Michigan',
    'America/Chicago': 'USA Central: Dallas, Houston, Austin, San Antonio, New Orleans, Minneapolis, St Louis, Kansas City, Nashville, Memphis, Milwaukee, Texas, Illinois, Louisiana, Minnesota, Missouri, Iowa, Wisconsin, Oklahoma, Arkansas, Alabama, Mississippi, Tennessee, Kansas, Nebraska',
    'America/Denver': 'USA Mountain: Salt Lake City, Albuquerque, Boise, Colorado, Utah, New Mexico, Wyoming, Montana, Idaho',
    'America/Phoenix': 'USA: Arizona, Tucson (no daylight saving)',
    'America/Los_Angeles': 'USA Pacific: San Francisco, San Diego, San Jose, Seattle, Portland, Las Vegas, Sacramento, Silicon Valley, California, Washington State, Oregon, Nevada',
    'America/Anchorage': 'USA: Alaska',
    'Pacific/Honolulu': 'USA: Hawaii, Maui',
    'America/Toronto': 'Canada Eastern: Ottawa, Montreal, Quebec, Ontario',
    'America/Winnipeg': 'Canada: Manitoba',
    'America/Regina': 'Canada: Saskatchewan',
    'America/Edmonton': 'Canada: Alberta, Calgary',
    'America/Vancouver': 'Canada: British Columbia, Victoria',
    'America/Halifax': 'Canada: Nova Scotia, New Brunswick, Prince Edward Island',
    'America/St_Johns': 'Canada: Newfoundland',
    'America/Mexico_City': 'Mexico: Guadalajara, Monterrey, Puebla',
    'America/Cancun': 'Mexico: Quintana Roo, Playa del Carmen, Tulum',
    'America/Tijuana': 'Mexico: Baja California',
    'America/Sao_Paulo': 'Brazil: Rio de Janeiro, Brasilia, Belo Horizonte, Curitiba, Porto Alegre',
    'America/Argentina/Buenos_Aires': 'Argentina: Cordoba, Rosario',
    'America/Bogota': 'Colombia: Medellin, Cali',
    'America/Lima': 'Peru: Cusco',
    'America/Santiago': 'Chile: Valparaiso',
    'Australia/Sydney': 'Australia: New South Wales, NSW, Canberra, ACT',
    'Australia/Melbourne': 'Australia: Victoria',
    'Australia/Brisbane': 'Australia: Queensland, Gold Coast',
    'Australia/Adelaide': 'Australia: South Australia',
    'Australia/Perth': 'Australia: Western Australia',
    'Australia/Darwin': 'Australia: Northern Territory',
    'Australia/Hobart': 'Australia: Tasmania',
    'Pacific/Auckland': 'New Zealand: Wellington, Christchurch',
    'Africa/Lagos': 'Nigeria: Abuja',
    'Africa/Johannesburg': 'South Africa: Cape Town, Durban, Pretoria',
    'Africa/Cairo': 'Egypt: Alexandria, Giza',
    'Africa/Nairobi': 'Kenya: Mombasa',
    'Africa/Casablanca': 'Morocco: Rabat, Marrakesh',
}
for zone, text in EXTRA.items():
    assert any(p[1] == zone for p in places) or os.path.exists(f'{TAB}/{zone}'), zone
    region, _, names = text.partition(': ')
    if not names: continue
    for n in names.split(', '):
        places.append([n, zone, region])

places.sort(key=lambda p: p[0].lower())

with open(f'{ROOT}/NotchWindows/src/js/modules/tzplaces.js', 'w', encoding='utf-8') as f:
    f.write('// Generated by scripts/gen_timezones.py: [place, time zone, country / region].\n')
    f.write('export const PLACES = ' + json.dumps(places, ensure_ascii=False, separators=(',', ':')) + ';\n')

def s(x): return json.dumps(x, ensure_ascii=False)
with open(f'{ROOT}/NotchApple/Modules/WorldClock/TimeZonePlaces.swift', 'w', encoding='utf-8') as f:
    f.write('// Generated by scripts/gen_timezones.py: every country and region with its own time,\n')
    f.write('// plus well-known cities and states, so World Clock search finds "India" or "Texas".\n\n')
    f.write('enum TimeZonePlaces {\n    static let all: [(name: String, zone: String, detail: String)] = [\n')
    for n, z, d in places:
        f.write(f'        ({s(n)}, {s(z)}, {s(d)}),\n')
    f.write('    ]\n}\n')
print(len(places), 'places')
