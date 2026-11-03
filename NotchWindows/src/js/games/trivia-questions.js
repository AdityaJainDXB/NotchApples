// Daily Trivia's question bank, shared by the Mac and Windows apps (see trivia-logic.js).
// 420 multiple-choice questions written for this app (easy to medium, stable facts), four options each and one correct answer.
// One line per question:  Category | Question | Correct answer | Wrong 1 | Wrong 2 | Wrong 3 | One-line explanation
//
// IMPORTANT: the question of the day is picked by position in this list, so do NOT reorder, remove or insert questions:
// that would change which question everybody gets on a given day (and which option sits where, since the position of the
// correct answer is worked out from the question's position too). Only ever ADD new questions at the END of the list,
// and keep the count below 1009 (trivia-logic.js walks the list with a prime step of 1009).
(function () {
  'use strict';
  const RAW = `
Science|Which gas do plants take in from the air for photosynthesis?|Carbon dioxide|Oxygen|Nitrogen|Hydrogen|Plants use carbon dioxide, water and light to make sugar and release oxygen.
Science|What is the chemical symbol for gold?|Au|Ag|Go|Gd|Au comes from the Latin word aurum.
Science|What is the chemical formula for water?|H2O|HO2|H2O2|OH|Each water molecule has two hydrogen atoms and one oxygen atom.
Science|Which planet is closest to the Sun?|Mercury|Venus|Mars|Earth|Mercury orbits the Sun closer than any other planet.
Science|How many planets are in our solar system?|Eight|Seven|Nine|Ten|Mercury to Neptune makes eight planets.
Science|What force pulls objects toward the Earth?|Gravity|Magnetism|Friction|Inertia|Gravity is the attraction between masses, and Earth's is what we feel as weight.
Science|What is the hardest natural substance?|Diamond|Quartz|Steel|Granite|Diamond is the hardest natural material on the Mohs scale.
Science|Which planet is known as the Red Planet?|Mars|Jupiter|Mercury|Saturn|Iron oxide, or rust, on its surface gives Mars its red colour.
Science|What is the largest planet in our solar system?|Jupiter|Saturn|Neptune|Earth|Jupiter is more than twice as massive as all the other planets combined.
Science|What is the centre of an atom called?|Nucleus|Electron|Orbit|Shell|The nucleus holds the protons and neutrons.
Science|At sea level, at what temperature in Celsius does pure water boil?|100 degrees|90 degrees|110 degrees|212 degrees|Water boils at 100 degrees Celsius, which is 212 degrees Fahrenheit.
Science|At what temperature in Celsius does pure water freeze?|0 degrees|10 degrees|-10 degrees|32 degrees|Water freezes at 0 degrees Celsius, which is 32 degrees Fahrenheit.
Science|Which part of the blood carries oxygen around the body?|Red blood cells|White blood cells|Platelets|Plasma|Red blood cells contain haemoglobin, which binds oxygen.
Science|What is the human body's largest organ?|Skin|Liver|Heart|Lungs|The skin covers the whole body and is its largest organ.
Science|How many bones does an adult human body normally have?|206|106|306|256|Babies have more, but many fuse together, leaving 206 in adults.
Science|What do we call a material that lets electricity flow through it easily?|Conductor|Insulator|Resistor|Magnet|Metals such as copper are good conductors.
Science|Which gas makes up most of Earth's atmosphere?|Nitrogen|Oxygen|Carbon dioxide|Argon|Nitrogen is about 78 percent of the air we breathe.
Science|What is the Moon's main effect on the oceans?|Tides|Waves from wind|Currents from rivers|Salt levels|The Moon's gravity pulls the water and causes the tides.
Science|What is the chemical symbol for sodium?|Na|So|Sd|S|Na comes from the Latin word natrium.
Science|What is the chemical symbol for iron?|Fe|Ir|In|I|Fe comes from the Latin word ferrum.
Science|Which scientist developed the theory of general relativity?|Albert Einstein|Isaac Newton|Galileo Galilei|Niels Bohr|Einstein published general relativity in 1915.
Science|What is the study of living things called?|Biology|Geology|Chemistry|Astronomy|Biology comes from the Greek words for life and study.
Science|What is the study of rocks and the Earth called?|Geology|Biology|Meteorology|Zoology|Geology studies the solid Earth and the rocks it is made of.
Science|What is the unit used to measure electric current?|Ampere|Volt|Ohm|Watt|The ampere, or amp, measures how much charge flows each second.
Science|Which colour of visible light has the longest wavelength?|Red|Violet|Green|Blue|Red light has the longest wavelength, and violet has the shortest.
Science|What is the process by which water vapour becomes liquid water?|Condensation|Evaporation|Melting|Freezing|Condensation is why dew forms on cool surfaces.
Science|What is the name of our galaxy?|The Milky Way|Andromeda|Triangulum|Whirlpool|Our solar system sits in the Milky Way galaxy.
Science|What is the chemical symbol for oxygen?|O|Ox|Om|Og|The symbol for oxygen is the single letter O.
Science|What do we call an animal that eats only plants?|Herbivore|Carnivore|Omnivore|Insectivore|Herbivores such as cows and rabbits eat only plants.
Science|Which organ pumps blood around the human body?|Heart|Liver|Kidney|Stomach|The heart is a muscle that pumps blood through the blood vessels.
Science|What is the boiling point of water in Fahrenheit?|212 degrees|100 degrees|180 degrees|250 degrees|Water boils at 212 degrees Fahrenheit at sea level.
Science|What type of energy does a moving object have?|Kinetic energy|Potential energy|Thermal energy|Chemical energy|Kinetic energy is the energy of motion.
Science|What is the term for a substance made of only one kind of atom?|Element|Compound|Mixture|Solution|Gold, oxygen and iron are examples of elements.
Science|Which vitamin do we mainly get from sunlight on our skin?|Vitamin D|Vitamin C|Vitamin A|Vitamin B12|Skin makes vitamin D when it is exposed to sunlight.
Science|What is the speed of light closest to?|300,000 kilometres per second|3,000 kilometres per second|30,000 kilometres per second|3 million kilometres per second|Light travels about 300,000 kilometres every second in a vacuum.
Science|What is the name of the force that slows things down when surfaces rub together?|Friction|Gravity|Buoyancy|Tension|Friction resists motion between surfaces in contact.
Science|Which blood type is known as the universal donor for red blood cells?|O negative|AB positive|A positive|B negative|O negative red cells can be given to almost anyone.
Science|What is the main gas in the Sun?|Hydrogen|Oxygen|Carbon dioxide|Helium|The Sun is about three quarters hydrogen by mass.
Science|What is a baby frog called?|Tadpole|Cub|Pup|Kit|A tadpole grows legs and becomes a frog.
Science|What is the pH of pure water?|7|0|14|1|A pH of 7 is neutral, neither acid nor alkaline.
Science|Which instrument is used to look at very small things like cells?|Microscope|Telescope|Periscope|Barometer|A microscope magnifies tiny objects.
Science|Which instrument is used to measure air pressure?|Barometer|Thermometer|Anemometer|Hygrometer|A barometer measures atmospheric pressure.
Science|What do we call the layer of gas that surrounds the Earth?|Atmosphere|Crust|Mantle|Core|The atmosphere holds the air we breathe and shields us from some of the Sun's rays.
Science|How many hearts does an octopus have?|Three|One|Two|Eight|An octopus has two gill hearts and one main heart.
Science|Which is the lightest element?|Hydrogen|Helium|Lithium|Oxygen|Hydrogen has the lowest atomic mass of all elements.
Science|What is the name for the sugar found in milk?|Lactose|Glucose|Fructose|Sucrose|Lactose is the main sugar in milk.
Science|What is the Earth's natural satellite called?|The Moon|Phobos|Titan|Europa|The Moon is Earth's only natural satellite.
Science|What does a thermometer measure?|Temperature|Pressure|Speed|Humidity|A thermometer shows how hot or cold something is.
Science|What happens to most metals when they are heated?|They expand|They shrink|They turn to gas at once|They become magnetic|Most metals get slightly bigger as they heat up.
Science|Which planet has the most visible rings?|Saturn|Mars|Mercury|Venus|Saturn's bright rings are made of ice and rock.
Science|Which of these is a noble gas?|Neon|Chlorine|Nitrogen|Fluorine|Neon, helium and argon are noble gases that rarely react.
Science|What is the name for the shape of a DNA molecule?|Double helix|Triple spiral|Flat ring|Single chain|DNA is two strands twisted around each other.
Science|What is the term for the Earth's path around the Sun?|Orbit|Rotation|Axis|Eclipse|The Earth takes about 365 days to orbit the Sun.
Science|What is the name of the process plants use to make food from light?|Photosynthesis|Respiration|Digestion|Fermentation|Photosynthesis turns light, water and carbon dioxide into sugar.
Science|Which scientist is famous for discovering the laws of motion and gravity?|Isaac Newton|Charles Darwin|Marie Curie|Louis Pasteur|Newton described the laws of motion and universal gravitation in 1687.
Science|What is the chemical symbol for carbon?|C|Ca|Cr|Co|Carbon is the basis of all known life.
History|In which year did World War II end?|1945|1939|1918|1950|The war ended in 1945, with Germany surrendering in May and Japan in September.
History|Who was the first President of the United States?|George Washington|Abraham Lincoln|Thomas Jefferson|John Adams|Washington took office in 1789.
History|Which ancient civilisation built the pyramids at Giza?|The Egyptians|The Romans|The Greeks|The Aztecs|The Giza pyramids were built by the Egyptians about 4,500 years ago.
History|Which empire was ruled from Rome?|The Roman Empire|The Ottoman Empire|The Persian Empire|The Mongol Empire|Rome was the capital of the Roman Empire.
History|In which year did Christopher Columbus first reach the Americas?|1492|1392|1592|1776|Columbus landed in the Caribbean in 1492.
History|Which wall fell in 1989, helping to end the division of Germany?|The Berlin Wall|The Great Wall|Hadrian's Wall|The Western Wall|The Berlin Wall came down on 9 November 1989.
History|Who was the first person to walk on the Moon?|Neil Armstrong|Buzz Aldrin|Yuri Gagarin|John Glenn|Armstrong stepped onto the Moon on 20 July 1969.
History|In which year did the first Moon landing take place?|1969|1959|1972|1965|Apollo 11 landed on the Moon in July 1969.
History|Who was the first man in space?|Yuri Gagarin|Neil Armstrong|Alan Shepard|Buzz Aldrin|Gagarin orbited the Earth on 12 April 1961.
History|Which ship sank in 1912 after hitting an iceberg on its first voyage?|The Titanic|The Lusitania|The Mayflower|The Bismarck|The Titanic sank in the North Atlantic on 15 April 1912.
History|What was the name of the ship that carried the Pilgrims to America in 1620?|The Mayflower|The Santa Maria|The Endeavour|The Victory|The Mayflower reached what is now Massachusetts in 1620.
History|Which Roman leader was killed on the Ides of March in 44 BC?|Julius Caesar|Augustus|Nero|Caligula|Julius Caesar was stabbed by a group of senators.
History|Which queen ruled Britain for 63 years, from 1837 to 1901?|Queen Victoria|Queen Elizabeth I|Queen Anne|Queen Mary|Victoria's reign was the longest of any British monarch until Elizabeth II.
History|Which year did the American Declaration of Independence get adopted?|1776|1789|1812|1756|The Declaration was adopted on 4 July 1776.
History|Who painted the ceiling of the Sistine Chapel?|Michelangelo|Leonardo da Vinci|Raphael|Donatello|Michelangelo painted it between 1508 and 1512.
History|Which ancient people built Machu Picchu?|The Inca|The Maya|The Aztecs|The Olmecs|Machu Picchu was built by the Inca in the 1400s.
History|Which war was fought between the northern and southern states of the USA from 1861 to 1865?|The American Civil War|The War of 1812|The Revolutionary War|The Korean War|The Civil War followed the secession of the southern states.
History|Who led India's non-violent movement for independence from Britain?|Mahatma Gandhi|Jawaharlal Nehru|Subhas Chandra Bose|Bhagat Singh|Gandhi led campaigns of non-violent civil disobedience.
History|In what year did India become independent?|1947|1930|1950|1957|India became independent on 15 August 1947.
History|Which explorer was the first to sail around the world with his fleet, completed after his death?|Ferdinand Magellan|Christopher Columbus|Vasco da Gama|James Cook|Magellan died in 1521, but one ship of his fleet completed the trip.
History|What was the name of the first artificial satellite launched into space?|Sputnik 1|Explorer 1|Vostok 1|Apollo 1|The Soviet Union launched Sputnik 1 in October 1957.
History|Who was the British Prime Minister for most of World War II?|Winston Churchill|Neville Chamberlain|Clement Attlee|Margaret Thatcher|Churchill led Britain from 1940 to 1945.
History|Which civilisation created the first known writing system, cuneiform?|The Sumerians|The Romans|The Vikings|The Aztecs|The Sumerians of Mesopotamia wrote on clay tablets.
History|Which ancient city was destroyed by the eruption of Mount Vesuvius in 79 AD?|Pompeii|Athens|Carthage|Troy|Pompeii was buried under volcanic ash.
History|Who was the Egyptian boy king whose tomb was found in 1922?|Tutankhamun|Ramses II|Khufu|Akhenaten|Howard Carter found Tutankhamun's tomb in the Valley of the Kings.
History|Which seafaring people from Scandinavia raided Europe from about 800 to 1100 AD?|The Vikings|The Romans|The Normans|The Celts|Viking longships sailed across the seas and rivers of Europe.
History|Which battle in 1066 led to the Normans conquering England?|The Battle of Hastings|The Battle of Waterloo|The Battle of Agincourt|The Battle of Bosworth|William of Normandy won at Hastings.
History|Who was defeated at the Battle of Waterloo in 1815?|Napoleon Bonaparte|Julius Caesar|Louis XIV|Otto von Bismarck|Napoleon lost to British and Prussian forces.
History|What was the name of the period of great artistic rebirth in Europe that began in Italy in the 1300s?|The Renaissance|The Enlightenment|The Industrial Revolution|The Reformation|Renaissance means rebirth in French.
History|Who invented the printing press with movable metal type in Europe around 1440?|Johannes Gutenberg|Leonardo da Vinci|Galileo Galilei|Martin Luther|Gutenberg's press helped spread books across Europe.
History|Who was the first woman to fly solo across the Atlantic Ocean?|Amelia Earhart|Bessie Coleman|Harriet Quimby|Jacqueline Cochran|Earhart made the flight in 1932.
History|Which brothers made the first powered aeroplane flight in 1903?|The Wright brothers|The Montgolfier brothers|The Lumiere brothers|The Grimm brothers|The Wright brothers flew at Kitty Hawk, North Carolina.
History|Which US president gave the Gettysburg Address?|Abraham Lincoln|George Washington|Theodore Roosevelt|Ulysses Grant|Lincoln gave the speech in 1863.
History|Which ancient wonder stood in the harbour of Alexandria in Egypt?|The Lighthouse|The Colossus|The Hanging Gardens|The Mausoleum|The Pharos lighthouse guided ships into Alexandria.
History|Which Chinese dynasty built much of the Great Wall that survives today?|The Ming|The Han|The Tang|The Qin|Most of the surviving wall was built or rebuilt under the Ming dynasty.
History|Who was the leader of the Soviet Union during most of World War II?|Joseph Stalin|Vladimir Lenin|Nikita Khrushchev|Leon Trotsky|Stalin led the Soviet Union from the 1920s until 1953.
History|Which ancient Greek city was known for its warriors?|Sparta|Athens|Corinth|Delphi|Spartan boys trained as soldiers from a young age.
History|Which ancient Greek city is often called the birthplace of democracy?|Athens|Sparta|Thebes|Olympia|Athens developed an early form of democracy around 500 BC.
History|Where were the first modern Olympic Games held in 1896?|Athens|Paris|London|Rome|The first modern games took place in Athens, Greece.
History|What was the name of the Indian emperor who built the Taj Mahal for his wife?|Shah Jahan|Akbar|Ashoka|Babur|Shah Jahan built it in memory of Mumtaz Mahal.
History|Which US president ended slavery with the Emancipation Proclamation?|Abraham Lincoln|Andrew Jackson|Ulysses Grant|Thomas Jefferson|Lincoln issued the proclamation in 1863.
History|Which system of government is a country with a king or queen as head of state?|Monarchy|Republic|Democracy|Dictatorship|In a monarchy, the head of state is a king or queen.
History|In what year did the French Revolution begin?|1789|1689|1815|1848|The storming of the Bastille took place on 14 July 1789.
History|Which famous clock tower stands beside the Houses of Parliament in London?|Big Ben|Tower Bridge|The Shard|Nelson's Column|Big Ben is the nickname of the great bell in the Elizabeth Tower.
History|What year did the Berlin Wall go up?|1961|1945|1975|1989|East Germany began building the wall in August 1961.
History|Who was the first female Prime Minister of the United Kingdom?|Margaret Thatcher|Theresa May|Elizabeth II|Indira Gandhi|Thatcher took office in 1979.
History|Which disease killed millions of Europeans in the 1300s, known as the Black Death?|The plague|Smallpox|Malaria|Measles|The plague spread across Europe from 1347.
History|Who discovered that the Earth orbits the Sun in a book published in 1543?|Nicolaus Copernicus|Galileo Galilei|Johannes Kepler|Isaac Newton|Copernicus proposed that the Sun is at the centre.
History|Who was the first Emperor of Rome?|Augustus|Julius Caesar|Nero|Trajan|Augustus became the first emperor in 27 BC.
History|In which country did the Industrial Revolution begin?|Great Britain|France|Germany|The United States|It began in Britain in the late 1700s with steam power and factories.
History|Which sea voyage did James Cook make that mapped the east coast of Australia?|The Endeavour voyage|The Beagle voyage|The Santa Maria voyage|The Mayflower voyage|Cook sailed the Endeavour along the east coast in 1770.
History|Which Italian explorer wrote about travelling to China in the 1200s?|Marco Polo|Amerigo Vespucci|Christopher Columbus|Galileo|Marco Polo's book described his travels in Asia.
History|What was the ancient Roman public sports arena in Rome called?|The Colosseum|The Parthenon|The Pantheon|The Forum|The Colosseum hosted gladiator fights and public shows.
History|Which treaty ended World War I with Germany in 1919?|The Treaty of Versailles|The Treaty of Paris|The Treaty of Rome|The Treaty of Vienna|It was signed in the Palace of Versailles near Paris.
History|Which American civil rights leader gave the 'I Have a Dream' speech in 1963?|Martin Luther King Jr.|Malcolm X|Frederick Douglass|Rosa Parks|He gave the speech at the Lincoln Memorial in Washington.
Geography|What is the capital of France?|Paris|Lyon|Marseille|Nice|Paris has been the capital of France for centuries.
Geography|What is the capital of Japan?|Tokyo|Kyoto|Osaka|Nagoya|Tokyo is Japan's capital and its largest city.
Geography|What is the capital of Australia?|Canberra|Sydney|Melbourne|Perth|Canberra was built as the capital, partly to settle rivalry between Sydney and Melbourne.
Geography|What is the capital of Canada?|Ottawa|Toronto|Vancouver|Montreal|Ottawa is the capital, while Toronto is the largest city.
Geography|What is the capital of Brazil?|Brasilia|Rio de Janeiro|Sao Paulo|Salvador|Brasilia became the capital in 1960.
Geography|What is the capital of Italy?|Rome|Milan|Venice|Naples|Rome was the centre of the ancient Roman Empire.
Geography|What is the capital of Spain?|Madrid|Barcelona|Seville|Valencia|Madrid is in the centre of Spain.
Geography|What is the capital of Germany?|Berlin|Munich|Hamburg|Frankfurt|Berlin is Germany's capital and largest city.
Geography|What is the capital of Egypt?|Cairo|Alexandria|Luxor|Giza|Cairo stands on the River Nile.
Geography|What is the capital of India?|New Delhi|Mumbai|Kolkata|Chennai|New Delhi is the seat of India's government.
Geography|What is the capital of China?|Beijing|Shanghai|Hong Kong|Guangzhou|Beijing has been China's capital for much of its history.
Geography|What is the capital of Russia?|Moscow|Saint Petersburg|Kazan|Sochi|Moscow is Russia's capital and biggest city.
Geography|What is the capital of Mexico?|Mexico City|Guadalajara|Cancun|Monterrey|Mexico City is built on the site of the old Aztec capital.
Geography|What is the capital of Argentina?|Buenos Aires|Cordoba|Santiago|Montevideo|Buenos Aires lies on the River Plate.
Geography|What is the capital of Turkey?|Ankara|Istanbul|Izmir|Antalya|Ankara became the capital in 1923, not Istanbul.
Geography|What is the capital of South Korea?|Seoul|Busan|Incheon|Pyongyang|Seoul is on the Han River.
Geography|What is the capital of Thailand?|Bangkok|Phuket|Chiang Mai|Pattaya|Bangkok is Thailand's capital and largest city.
Geography|What is the capital of Kenya?|Nairobi|Mombasa|Kampala|Dodoma|Nairobi is Kenya's capital.
Geography|What is the capital of the United Kingdom?|London|Manchester|Edinburgh|Birmingham|London lies on the River Thames.
Geography|What is the capital of Portugal?|Lisbon|Porto|Madrid|Faro|Lisbon sits on the River Tagus.
Geography|What is the capital of Greece?|Athens|Thessaloniki|Sparta|Crete|Athens is one of the oldest cities in the world.
Geography|What is the capital of Sweden?|Stockholm|Gothenburg|Oslo|Malmo|Stockholm is built on islands.
Geography|What is the capital of Norway?|Oslo|Bergen|Stockholm|Helsinki|Oslo lies at the head of the Oslofjord.
Geography|What is the capital of New Zealand?|Wellington|Auckland|Christchurch|Queenstown|Wellington is on the southern tip of the North Island.
Geography|What is the capital of the Philippines?|Manila|Cebu|Davao|Quezon|Manila is on the island of Luzon.
Geography|What is the capital of Peru?|Lima|Cusco|Quito|Bogota|Lima is on the Pacific coast.
Geography|What is the largest ocean on Earth?|The Pacific Ocean|The Atlantic Ocean|The Indian Ocean|The Arctic Ocean|The Pacific covers about a third of Earth's surface.
Geography|Which is the longest river in Africa?|The Nile|The Congo|The Niger|The Zambezi|The Nile flows north to the Mediterranean Sea.
Geography|Which is the largest country in the world by area?|Russia|Canada|China|The United States|Russia spans eleven time zones.
Geography|Which is the smallest country in the world by area?|Vatican City|Monaco|San Marino|Liechtenstein|Vatican City covers about half a square kilometre.
Geography|Which continent is the Sahara desert in?|Africa|Asia|Australia|South America|The Sahara covers much of northern Africa.
Geography|On which continent is Brazil?|South America|North America|Africa|Europe|Brazil is the largest country in South America.
Geography|Which is the highest mountain above sea level?|Mount Everest|K2|Kilimanjaro|Mont Blanc|Everest rises to about 8,849 metres.
Geography|Which mountain range separates Europe from Asia in Russia?|The Ural Mountains|The Alps|The Andes|The Rockies|The Urals run north to south through Russia.
Geography|Which river flows through London?|The Thames|The Seine|The Danube|The Rhine|The Thames flows through the middle of London.
Geography|Which river flows through Paris?|The Seine|The Thames|The Rhine|The Loire|The Seine flows through the middle of Paris.
Geography|What is the longest river in South America?|The Amazon|The Orinoco|The Parana|The Magdalena|The Amazon carries more water than any other river.
Geography|Which country has the city of Venice?|Italy|Greece|Spain|France|Venice is built on islands in a lagoon in northern Italy.
Geography|Which country covers an entire continent by itself?|Australia|Greenland|Iceland|Madagascar|Australia is the only country that covers a whole continent.
Geography|Which sea lies between Europe and Africa?|The Mediterranean Sea|The Red Sea|The Black Sea|The Baltic Sea|Mediterranean means in the middle of the land.
Geography|Which is the largest desert in the world, including cold deserts?|Antarctica|The Sahara|The Gobi|The Arabian Desert|Antarctica is a polar desert because it gets very little rain or snow.
Geography|Which country is home to the Great Barrier Reef?|Australia|Mexico|Brazil|Indonesia|The reef lies off the coast of Queensland.
Geography|Besides China, which country has more than a billion people?|India|Brazil|The United States|Indonesia|India and China each have more than 1.4 billion people.
Geography|Which US state is the largest by area?|Alaska|Texas|California|Montana|Alaska is more than twice the size of Texas.
Geography|What is the capital of the US state of California?|Sacramento|Los Angeles|San Francisco|San Diego|Sacramento is California's capital.
Geography|What is the capital city of the United States?|Washington, D.C.|New York|Philadelphia|Boston|Washington, D.C. is named for George Washington.
Geography|Which strait separates Spain from Morocco?|Strait of Gibraltar|Bering Strait|Strait of Hormuz|English Channel|The Strait of Gibraltar is only about 14 kilometres wide at its narrowest.
Geography|Which famous canal links the Mediterranean Sea with the Red Sea?|The Suez Canal|The Panama Canal|The Kiel Canal|The Erie Canal|The Suez Canal opened in 1869.
Geography|Which famous canal links the Atlantic and Pacific oceans?|The Panama Canal|The Suez Canal|The Corinth Canal|The Grand Canal|The Panama Canal opened in 1914.
Geography|Which African country has the city of Cape Town?|South Africa|Namibia|Kenya|Tanzania|Cape Town is the legislative capital of South Africa.
Geography|Which two countries share the longest land border in the world?|Canada and the United States|Russia and China|Brazil and Argentina|India and Pakistan|The Canada and United States border is about 8,900 kilometres long.
Geography|Which country is known as the Land of the Rising Sun?|Japan|China|Thailand|South Korea|Japan's name in Japanese, Nihon, means origin of the sun.
Geography|Which is the largest lake in Africa?|Lake Victoria|Lake Chad|Lake Tanganyika|Lake Malawi|Lake Victoria is shared by Uganda, Kenya and Tanzania.
Geography|Which of these is an island country?|Iceland|Austria|Switzerland|Hungary|Iceland is an island in the North Atlantic.
Geography|On which continent is the country of Egypt mainly located?|Africa|Asia|Europe|South America|Egypt is in north-eastern Africa, with the Sinai Peninsula in Asia.
Geography|What is the name of the line of latitude at 0 degrees?|The Equator|The Tropic of Cancer|The Prime Meridian|The Arctic Circle|The Equator divides the Earth into the northern and southern hemispheres.
Geography|Which ocean lies to the east of Africa?|The Indian Ocean|The Atlantic Ocean|The Pacific Ocean|The Arctic Ocean|The Indian Ocean touches Africa's east coast.
Geography|Which city is known as the Big Apple?|New York City|Los Angeles|Chicago|Boston|New York City has been nicknamed the Big Apple since the 1920s.
Nature|What is the largest animal on Earth?|The blue whale|The African elephant|The giraffe|The great white shark|The blue whale can grow longer than 25 metres.
Nature|What is the fastest land animal?|The cheetah|The lion|The horse|The leopard|A cheetah can run at about 100 kilometres per hour in short bursts.
Nature|What is the tallest animal in the world?|The giraffe|The elephant|The ostrich|The camel|A giraffe can be about 5 metres tall.
Nature|How many legs does a spider have?|Eight|Six|Ten|Four|Spiders are arachnids and have eight legs.
Nature|How many legs does an insect have?|Six|Four|Eight|Ten|All adult insects have six legs.
Nature|Which bird is known for not being able to fly and living in Antarctica?|Penguin|Albatross|Puffin|Seagull|Penguins swim instead of flying.
Nature|What do bees collect from flowers to make honey?|Nectar|Pollen only|Sap|Water|Bees turn nectar into honey inside the hive.
Nature|Which animal is the largest living species of bird?|The ostrich|The emu|The eagle|The albatross|The ostrich can be over 2 metres tall.
Nature|Which mammal can fly?|The bat|The flying squirrel|The sugar glider|The ostrich|Bats are the only mammals that can truly fly.
Nature|What is a group of lions called?|A pride|A pack|A herd|A flock|A pride of lions lives and hunts together.
Nature|What is a group of fish called?|A school|A herd|A pack|A swarm|Fish that swim together are called a school or shoal.
Nature|What is the name for a baby cat?|Kitten|Puppy|Cub|Calf|A baby cat is a kitten.
Nature|What is the name for a baby sheep?|Lamb|Calf|Foal|Kid|A baby sheep is a lamb.
Nature|What do pandas mainly eat?|Bamboo|Fish|Meat|Fruit|Giant pandas eat mostly bamboo.
Nature|Which animal has a long trunk?|The elephant|The giraffe|The hippo|The rhinoceros|An elephant uses its trunk to smell, drink and grab things.
Nature|Which ocean animal has eight arms?|The octopus|The jellyfish|The starfish|The dolphin|An octopus has eight arms.
Nature|Which sea creature is a mammal, not a fish?|The dolphin|The shark|The tuna|The seahorse|Dolphins breathe air and feed their young milk.
Nature|What colour is the skin of a polar bear under its fur?|Black|White|Pink|Brown|A polar bear's skin is black, which helps it soak up heat.
Nature|Which plant produces acorns?|The oak tree|The pine tree|The maple tree|The birch tree|Acorns are the nuts of oak trees.
Nature|Which gas do trees release that people need to breathe?|Oxygen|Carbon dioxide|Methane|Helium|Trees release oxygen during photosynthesis.
Nature|Which part of a plant takes in water from the soil?|The roots|The leaves|The petals|The stem|Roots absorb water and minerals from the soil.
Nature|What is the name of the process when a caterpillar changes into a butterfly?|Metamorphosis|Migration|Hibernation|Germination|Metamorphosis means change of form.
Nature|What is it called when animals sleep through the winter?|Hibernation|Migration|Camouflage|Evolution|During hibernation an animal's body slows down to save energy.
Nature|Which bird is famous for mimicking human speech?|The parrot|The eagle|The owl|The swan|Parrots can copy sounds and words they hear.
Nature|Which large cat has a mane?|The male lion|The tiger|The leopard|The jaguar|Only male lions grow a mane.
Nature|Which animal is known to carry its home on its back?|The snail|The rabbit|The ant|The hamster|A snail's shell is its home and protection.
Nature|What is the tallest type of grass in the world?|Bamboo|Wheat|Sugar cane|Rice|Some bamboo species grow taller than 30 metres.
Nature|What is a female horse called?|A mare|A stallion|A colt|A foal|A mare is an adult female horse.
Nature|What is a baby horse called?|A foal|A calf|A cub|A kid|A foal is a young horse.
Nature|What is a baby kangaroo called?|A joey|A cub|A kit|A pup|A joey grows in its mother's pouch.
Nature|Which country are kangaroos found wild in?|Australia|Brazil|India|South Africa|Kangaroos live wild in Australia and nearby New Guinea.
Nature|What is the name of the biggest rainforest on Earth?|The Amazon|The Congo|The Daintree|The Black Forest|The Amazon rainforest covers much of northern South America.
Nature|What is a rainbow made of?|Sunlight split by water droplets|Rain mixed with paint|Reflected clouds|Static electricity|Water droplets bend and split sunlight into its colours.
Nature|How many colours do we usually say a rainbow has?|Seven|Five|Six|Nine|The usual list is red, orange, yellow, green, blue, indigo and violet.
Nature|What type of animal is a dolphin?|A mammal|A fish|A reptile|An amphibian|Dolphins are warm-blooded mammals.
Nature|What type of animal is a frog?|An amphibian|A reptile|A mammal|A fish|Frogs live part of their life in water and part on land.
Nature|What type of animal is a crocodile?|A reptile|An amphibian|A mammal|A fish|Crocodiles are cold-blooded reptiles.
Nature|Which animal is known as the ship of the desert?|The camel|The horse|The donkey|The ostrich|Camels can cross deserts and go days without water.
Nature|What does a caterpillar turn into after it forms a chrysalis or cocoon?|A butterfly or moth|A beetle|A bee|A dragonfly|Caterpillars become butterflies or moths.
Nature|What is the main food of a koala?|Eucalyptus leaves|Bamboo|Grass|Fruit|Koalas eat mostly eucalyptus leaves.
Nature|Which animal is the main source of wool?|The sheep|The cow|The pig|The horse|Wool is shorn from sheep.
Nature|Which tree has cones and needle-shaped leaves?|The pine|The oak|The maple|The willow|Pines are conifers.
Nature|Which season comes after winter in the northern hemisphere?|Spring|Summer|Autumn|Monsoon|The order of the seasons is winter, spring, summer, autumn.
Nature|What is the name for a large area of ice that moves slowly down a valley?|A glacier|An iceberg|A geyser|A lagoon|A glacier is a river of ice.
Nature|What causes thunder?|Lightning heating the air|Clouds colliding|Rain hitting the ground|Wind in the mountains|Lightning heats the air so fast that it expands and makes a booming sound.
Nature|What do we call a hole in the Earth's surface that spews lava?|A volcano|A canyon|A crater lake|A cave|A volcano is an opening where molten rock reaches the surface.
Nature|What is the usual name for an extremely tall wave caused by an earthquake under the sea?|A tsunami|A tide|A whirlpool|A monsoon|Tsunami is a Japanese word meaning harbour wave.
Nature|What is the longest snake in the world?|The reticulated python|The black mamba|The cobra|The rattlesnake|The reticulated python can be over 6 metres long.
Nature|What is the only continent with no permanent human residents?|Antarctica|Australia|Europe|South America|Only scientists live there for periods of time.
Nature|What do we call animals that hunt other animals for food?|Predators|Prey|Scavengers|Herbivores|A predator hunts prey.
Nature|How many pairs of wings do most butterflies have?|Two|One|Three|Four|Butterflies have four wings, which is two pairs.
Nature|What is the name for frozen rain that falls as small balls of ice?|Hail|Sleet|Snow|Fog|Hail forms in strong thunderstorms.
Sport|How many players from one team are on the field in a football (soccer) match?|Eleven|Nine|Ten|Twelve|Each side plays with eleven players, including the goalkeeper.
Sport|How many players are on a basketball team on the court at once?|Five|Six|Seven|Four|Each team has five players on the court.
Sport|In which sport do you score a try?|Rugby|Football|Tennis|Golf|A try is worth points in rugby when the ball is grounded over the line.
Sport|In which sport would you perform a slam dunk?|Basketball|Volleyball|Netball|Handball|A slam dunk is scoring by pushing the ball down through the hoop.
Sport|How many rings are on the Olympic flag?|Five|Four|Six|Seven|The five rings stand for five regions of the world.
Sport|How often are the Summer Olympic Games held?|Every four years|Every two years|Every three years|Every year|The Summer Games take place every four years.
Sport|Which country hosted the 2016 Summer Olympics?|Brazil|China|Great Britain|Japan|Rio de Janeiro hosted the 2016 Games.
Sport|In which sport do players use a racket and a shuttlecock?|Badminton|Squash|Tennis|Table tennis|A shuttlecock is the feathered projectile used in badminton.
Sport|What is the maximum score in a single frame of ten-pin bowling?|30|10|20|300|A strike followed by two more strikes scores up to 30 for one frame.
Sport|How many holes are played in a standard round of golf?|18|9|12|21|A full round of golf has eighteen holes.
Sport|What is the distance of a marathon, to the nearest kilometre?|42 kilometres|26 kilometres|50 kilometres|21 kilometres|A marathon is 42.195 kilometres.
Sport|In which sport is the Wimbledon championship held?|Tennis|Golf|Cricket|Rugby|Wimbledon is the oldest tennis tournament in the world.
Sport|In which sport do you use a bat, a ball and wickets?|Cricket|Baseball|Rounders|Softball|Cricket uses wickets made of stumps and bails.
Sport|How many bases are there on a baseball field?|Four|Three|Five|Six|There are first, second and third base, plus home plate.
Sport|How many players are in a volleyball team on the court?|Six|Five|Seven|Eight|Each volleyball team plays with six players on court.
Sport|In which sport do athletes compete for the Tour de France?|Cycling|Running|Swimming|Rowing|The Tour de France is an annual multi-stage bicycle race.
Sport|What colour is the jersey worn by the overall leader of the Tour de France?|Yellow|Red|Green|Blue|The leader wears the yellow jersey, called the maillot jaune.
Sport|Which country won the first FIFA World Cup in 1930?|Uruguay|Brazil|Argentina|Italy|Uruguay hosted and won the first World Cup.
Sport|Which country has won the most men's FIFA World Cups?|Brazil|Germany|Italy|Argentina|Brazil has won the men's World Cup five times.
Sport|Which country hosted the 2022 FIFA World Cup?|Qatar|Russia|Brazil|Germany|The 2022 tournament was held in Qatar.
Sport|Which country won the 2022 FIFA World Cup?|Argentina|France|Brazil|Croatia|Argentina beat France on penalties in the final.
Sport|What do you call it when a golfer takes one shot to put the ball in the hole from the tee?|A hole in one|An eagle|A birdie|A bogey|A hole in one is also known as an ace.
Sport|In which sport do you find a pommel horse?|Gymnastics|Equestrian|Rowing|Fencing|The pommel horse is a men's gymnastics apparatus.
Sport|What is the name of the area where a boxing match takes place?|The ring|The court|The pitch|The rink|Boxing is held in a ring with ropes around it.
Sport|What is the name of the ice sport where players slide a stone toward a target?|Curling|Bobsleigh|Luge|Skeleton|In curling, teams slide stones to a target called the house.
Sport|Which sport is played at Lord's and the Oval?|Cricket|Rugby|Football|Tennis|Both are famous cricket grounds in London.
Sport|How many points is a touchdown worth in American football before the extra point?|Six|Three|Seven|Five|A touchdown scores six points.
Sport|How long is an Olympic swimming pool?|50 metres|25 metres|100 metres|75 metres|Olympic pools are 50 metres long.
Sport|How many players are on a cricket team on the field?|Eleven|Nine|Ten|Twelve|A cricket side has eleven players.
Sport|In which sport would you use a puck?|Ice hockey|Field hockey|Lacrosse|Cricket|A puck is a hard rubber disc used in ice hockey.
Sport|Which sport uses the terms love, deuce and advantage?|Tennis|Cricket|Golf|Boxing|These are all terms in a tennis scoring system.
Sport|In which city did the first modern Olympic Games take place?|Athens|Paris|London|Los Angeles|Athens hosted in 1896.
Sport|How many minutes does a standard football (soccer) match last, not including extra time?|90|60|80|100|Two halves of 45 minutes each.
Sport|What colour card does a referee show to send off a football player?|Red|Yellow|Green|Blue|A red card means the player must leave the field.
Sport|In which sport is a shot called an ace?|Tennis|Cricket|Rugby|Bowling|An ace is a serve the opponent cannot return.
Sport|In which sport do teams compete for the Stanley Cup?|Ice hockey|Basketball|Baseball|Football|The Stanley Cup is the championship trophy of the NHL.
Sport|Which sport is known as the beautiful game?|Football|Cricket|Baseball|Rugby|Football, or soccer, has been nicknamed the beautiful game.
Sport|In which sport do competitors perform a triple jump?|Athletics|Swimming|Gymnastics|Diving|The triple jump is a hop, a step and a jump.
Sport|How many sides does a standard boxing ring have?|Four|Three|Five|Six|A boxing ring is square, with ropes on four sides.
Sport|What is the name of the large Spanish bicycle race held every year?|Vuelta a Espana|Giro d'Italia|Tour de France|Paris-Roubaix|The Vuelta a Espana is one of cycling's three grand tours.
Sport|In which sport would you do a backstroke?|Swimming|Rowing|Cycling|Tennis|The backstroke is swum on the back.
Sport|What is the name for a score of three under par on a single golf hole?|An albatross|A birdie|A bogey|An eagle|An albatross is three strokes under par.
Sport|How many pins are used in ten-pin bowling?|Ten|Nine|Eight|Twelve|Ten-pin bowling uses ten pins.
Sport|In which sport do players try to hit a shuttlecock over a high net?|Badminton|Volleyball|Squash|Tennis|Badminton uses a feathered shuttlecock.
Sport|In which sport is the Ryder Cup contested?|Golf|Tennis|Cricket|Cycling|The Ryder Cup is a team golf match between Europe and the United States.
Sport|Which athlete is nicknamed the Lightning Bolt and holds the 100 metres world record?|Usain Bolt|Carl Lewis|Michael Johnson|Justin Gatlin|Bolt ran 9.58 seconds in 2009.
Sport|In which sport do you try to throw a javelin the furthest?|Athletics|Swimming|Rowing|Fencing|The javelin throw is an athletics field event.
Sport|In which sport do two teams pull on opposite ends of a rope?|Tug of war|Rowing|Sailing|Curling|Tug of war was an Olympic sport in the early Games.
Sport|What is the maximum number of strikes in a bowling game?|Twelve|Ten|Eleven|Nine|A perfect game of bowling has twelve strikes in a row.
Sport|In football, what is the name for when a player scores three goals in one game?|A hat trick|A brace|A treble|A triple|A hat trick is three goals by one player in a match.
Sport|What do you call a score of one under par on a golf hole?|A birdie|An eagle|A bogey|A par|One stroke under par is a birdie.
Sport|In which sport is the Grand Slam at Roland Garros held?|Tennis|Golf|Cricket|Cycling|The French Open is played at Roland Garros in Paris on clay courts.
Food|Which country is the food pizza originally from?|Italy|France|Greece|Spain|Modern pizza began in Naples, Italy.
Food|Which country is sushi most closely linked to?|Japan|China|Thailand|Korea|Sushi is a traditional Japanese dish of vinegared rice with fish or other toppings.
Food|What is the main ingredient of guacamole?|Avocado|Tomato|Pepper|Cucumber|Guacamole is made by mashing avocados.
Food|What is the main ingredient in hummus?|Chickpeas|Lentils|Beans|Rice|Hummus is a dip made from chickpeas, tahini and lemon.
Food|What are dried plums called?|Prunes|Raisins|Currants|Dates|Prunes are dried plums.
Food|Which spice gives curry its yellow colour?|Turmeric|Paprika|Cinnamon|Cumin|Turmeric is a bright yellow root spice.
Food|From which plant do we get chocolate?|The cacao tree|The coffee plant|The vanilla orchid|The tea plant|Chocolate is made from cacao beans.
Food|Which nut is used to make marzipan?|Almond|Walnut|Peanut|Cashew|Marzipan is made from ground almonds and sugar.
Food|What is the main ingredient of traditional bread?|Flour|Rice|Potato|Corn syrup|Bread is made from flour, water and yeast.
Food|Which fruit is dried to make raisins?|Grapes|Plums|Apricots|Figs|Raisins are dried grapes.
Food|What is the main ingredient of cheese?|Milk|Eggs|Flour|Cream only|Cheese is made by curdling milk.
Food|What is tofu made from?|Soybeans|Rice|Wheat|Corn|Tofu is made from curdled soy milk.
Food|What is the Japanese dish of thinly sliced raw fish served without rice?|Sashimi|Tempura|Ramen|Teriyaki|Sashimi is thinly sliced raw fish.
Food|What is the French word for bread that is long and thin?|Baguette|Croissant|Brioche|Crepe|A baguette is a long, thin loaf of bread.
Food|Which fruit is the largest tree-grown fruit?|Jackfruit|Watermelon|Pineapple|Coconut|The jackfruit can weigh more than 30 kilograms.
Food|What is the main ingredient in a traditional Greek salad besides tomatoes and cucumber?|Feta cheese|Mozzarella|Cheddar|Parmesan|Greek salad usually has feta, olives, tomato and cucumber.
Food|What type of food is a baguette?|Bread|Cheese|Pasta|Cake|A baguette is a type of bread.
Food|Which vegetable is used to make french fries?|Potato|Carrot|Parsnip|Sweet corn|French fries are potato strips fried in oil.
Food|What do we call the green vegetable that looks like tiny trees?|Broccoli|Cabbage|Spinach|Celery|Broccoli florets look like little trees.
Food|What is the main ingredient of pasta?|Wheat flour|Rice|Potato|Corn|Most pasta is made from wheat flour and water.
Food|What is the most widely eaten staple food in much of Asia?|Rice|Wheat|Potato|Maize|Rice is the main food for billions of people in Asia.
Food|Which drink is made from roasted and ground beans of a tropical plant?|Coffee|Tea|Cocoa|Cola|Coffee is brewed from roasted coffee beans.
Food|Which citrus fruit is usually yellow and very sour?|Lemon|Orange|Grapefruit|Lime|Lemons are yellow and sour.
Food|Which fruit has its seeds on the outside?|Strawberry|Raspberry|Blueberry|Cherry|The tiny seeds on a strawberry are on its outside skin.
Food|Which red fruit is often thought of as a vegetable and is used in ketchup?|Tomato|Beetroot|Radish|Red pepper|Tomatoes are botanically fruit.
Food|What is a baby cow's meat called?|Veal|Mutton|Venison|Pork|Veal comes from calves.
Food|Which cheese is traditionally used on pizza Margherita?|Mozzarella|Cheddar|Brie|Gouda|Mozzarella melts well on a pizza.
Food|Which grain is used to make porridge oats?|Oats|Barley|Rye|Maize|Porridge oats are rolled oats.
Food|What is the French name for a thin pancake?|Crepe|Brioche|Eclair|Tartine|A crepe is a very thin pancake.
Food|Which fruit is traditionally pressed to make cider?|Apples|Pears|Grapes|Cherries|Cider is made from fermented apple juice.
Food|Which type of pasta is long and thin, like strings?|Spaghetti|Penne|Fusilli|Farfalle|Spaghetti means little strings in Italian.
Food|Which type of pasta is shaped like a bow tie?|Farfalle|Penne|Rigatoni|Spaghetti|Farfalle means butterflies in Italian.
Food|Which seeds are used to make popcorn?|Corn|Wheat|Rice|Barley|Popcorn is made of corn kernels that burst when heated.
Food|What vegetable makes you cry when you cut it?|Onion|Carrot|Potato|Cabbage|Cutting an onion releases a gas that irritates the eyes.
Food|Which liquid is made by bees?|Honey|Syrup|Nectar|Maple sap|Bees make honey from flower nectar.
Food|What is the usual main ingredient of a traditional Indian dal?|Lentils|Rice|Potatoes|Spinach|Dal is a dish made from split lentils or pulses.
Food|What is the hottest part of a chilli pepper?|The seeds and the white membrane|The stem|The skin|The leaves|Most of the heat is in the white membrane around the seeds.
Food|Which nut is the main ingredient of peanut butter?|Peanuts|Almonds|Cashews|Walnuts|Peanut butter is made from ground peanuts.
Food|What do we call the meal eaten in the morning?|Breakfast|Lunch|Supper|Brunch|Breakfast breaks the overnight fast.
Food|Which country is Parmesan cheese from?|Italy|France|Switzerland|Spain|Parmigiano Reggiano comes from northern Italy.
Food|Which country is feta cheese traditionally from?|Greece|Turkey|Italy|Denmark|Feta is a brined cheese from Greece.
Food|Which country is the dish paella from?|Spain|Mexico|Portugal|Italy|Paella is a rice dish from Valencia in Spain.
Food|Which vegetable is the main ingredient of the Korean side dish kimchi?|Cabbage|Carrot|Radish only|Cucumber|Kimchi is most often made from fermented napa cabbage.
Food|Which country is the dish tacos from?|Mexico|Spain|Peru|Brazil|Tacos are a traditional Mexican food.
Food|Which small green fruit is pressed to make olive oil?|Olives|Grapes|Peas|Limes|Olive oil is pressed from olives.
Tech|What does CPU stand for?|Central Processing Unit|Computer Personal Unit|Central Program Utility|Core Power Unit|The CPU is the part of a computer that runs instructions.
Tech|What does USB stand for?|Universal Serial Bus|United System Backup|Universal Storage Block|Unified Serial Board|USB is a standard for connecting devices to computers.
Tech|What does Wi-Fi allow devices to do?|Connect to a network wirelessly|Charge a battery|Print in colour|Clean a screen|Wi-Fi uses radio waves to connect devices to a network.
Tech|What does HTML stand for?|HyperText Markup Language|HyperTool Machine Language|Home Text Mark Language|High Transfer Markup Logic|HTML describes the structure of web pages.
Tech|What does RAM stand for?|Random Access Memory|Read And Move|Rapid Access Module|Run All Memory|RAM is a computer's short-term working memory.
Tech|What does GPS stand for?|Global Positioning System|General Position Signal|Global Planet Scanner|Ground Path Service|GPS uses satellites to work out where you are.
Tech|What does PDF stand for?|Portable Document Format|Printed Data File|Personal Document Folder|Public Display Format|PDF files look the same on any device.
Tech|What is the name for a small picture that represents a program or file on a screen?|Icon|Cursor|Pixel|Font|Icons are small pictures you click to open things.
Tech|What are the tiny dots that make up a digital image called?|Pixels|Bytes|Bits|Vectors|Each pixel is one point of colour on the screen.
Tech|How many bits are there in a byte?|Eight|Four|Sixteen|Ten|A byte is a group of eight bits.
Tech|What is the binary number system based on?|Two digits, 0 and 1|Ten digits|Eight digits|Sixteen digits|Computers store information using ones and zeros.
Tech|Which company makes the iPhone?|Apple|Samsung|Google|Microsoft|The first iPhone was released by Apple in 2007.
Tech|Which company makes the Windows operating system?|Microsoft|Apple|Google|IBM|Windows is made by Microsoft.
Tech|What is the name for a programming error in software?|A bug|A virus|A patch|A cookie|A bug is a mistake in a program's code.
Tech|What is the term for software designed to harm a computer?|Malware|Firmware|Freeware|Shareware|Malware includes viruses, trojans and ransomware.
Tech|What do the letters www stand for in a web address?|World Wide Web|Wide Web World|Wireless Web Works|World Web Window|It stands for World Wide Web.
Tech|Who is credited with inventing the World Wide Web?|Tim Berners-Lee|Bill Gates|Steve Jobs|Alan Turing|Berners-Lee proposed the web in 1989 while working at CERN.
Tech|Which of these is a web browser?|Firefox|Photoshop|Excel|Notepad|Firefox is a browser made by Mozilla.
Tech|Which of these is a search engine?|Google|Chrome|Safari|Edge|Google is a search engine, while the others are browsers.
Tech|What is the name of the key on a keyboard used to remove the letter before the cursor?|Backspace|Tab|Shift|Escape|Backspace deletes to the left.
Tech|What does the Escape key usually do?|Cancels or closes something|Saves a file|Prints a page|Turns the computer off|Esc commonly cancels or closes a window or menu.
Tech|What is the name for a device that points and clicks on a screen?|Mouse|Monitor|Speaker|Printer|A mouse moves a pointer on the screen.
Tech|Which part of a computer stores files for a long time, even when it is off?|Hard drive or SSD|RAM|The processor|The power supply|Drives keep files when the power is off.
Tech|What is the common name for a computer that can be folded and carried?|Laptop|Server|Mainframe|Router|A laptop has the screen, keyboard and battery in one case.
Tech|What is the name of the device that sends internet signal around a home?|Router|Printer|Scanner|Keyboard|A router connects your devices to the internet.
Tech|What is the term for an online store of files you can reach from any device?|Cloud storage|A hard disk|A floppy disk|A card reader|Cloud storage keeps your files on remote servers.
Tech|Which programming language shares its name with a type of coffee?|Java|Python|Ruby|Swift|Java is named after the coffee.
Tech|Which popular programming language is named after a comedy group?|Python|Ruby|Swift|Rust|Python was named after Monty Python, a British comedy group.
Tech|Which company developed the PlayStation game console?|Sony|Nintendo|Microsoft|Sega|Sony released the first PlayStation in 1994.
Tech|Which company created Mario, Zelda and the Switch?|Nintendo|Sony|Sega|Atari|Nintendo created Mario, Zelda and the Switch.
Tech|What is the name for the process of copying data so it can be restored later?|Backup|Download|Install|Format|A backup is a spare copy of your data.
Tech|What is the term for the process of making a copy of a file from the internet to your device?|Downloading|Streaming only|Uploading|Rebooting|Downloading saves a file from the internet to your device.
Tech|What is the name for the main circuit board in a computer?|Motherboard|Keyboard|Dashboard|Whiteboard|The motherboard connects all the parts of a computer.
Tech|What does an emoji represent?|A small picture or face|A sound|A password|A web address|Emoji are small pictures used in messages.
Tech|What does the term 'reboot' mean?|Restart|Delete|Shut down for good|Update|To reboot is to restart a device.
Tech|What do you call the process of turning a device on from a completely off state?|Booting up|Logging off|Saving|Syncing|Booting starts a computer.
Tech|Which kind of device uses a touchscreen and makes phone calls?|Smartphone|Printer|Router|Projector|A smartphone combines a phone with a computer.
Tech|What do we call a secret word that protects an account?|Password|Username|Cookie|Domain|A password proves it is you.
Tech|Which kind of storage uses lasers to read a shiny disc?|CD or DVD|SSD|RAM|USB drive|Optical discs are read with a laser.
Tech|What does AI stand for?|Artificial Intelligence|Automatic Internet|Advanced Input|Applied Index|AI is the ability of machines to do tasks that need human-like thinking.
Tech|Which of these is a social video platform for short clips?|TikTok|Excel|Dropbox|Zoom|TikTok is a platform for short videos.
Tech|What is the common name for the number that identifies a device on a network, in letters IP?|IP address|Zip code|Phone number|Serial number|An IP address identifies a device on a network.
Tech|What does LED stand for?|Light Emitting Diode|Large Energy Display|Low Electric Device|Linear Energy Diode|LEDs give off light when current flows through them.
General|How many days are there in a leap year?|366|365|364|360|A leap year has an extra day, 29 February.
General|How many days are there in a non-leap year?|365|364|366|360|A common year has 365 days.
General|How many months have 31 days?|Seven|Six|Eight|Five|January, March, May, July, August, October and December have 31 days.
General|How many minutes are there in an hour?|60|50|100|30|An hour is made of sixty minutes.
General|How many seconds are there in a minute?|60|30|100|120|A minute has sixty seconds.
General|How many sides does a hexagon have?|Six|Five|Seven|Eight|Hex means six.
General|How many sides does a pentagon have?|Five|Four|Six|Seven|Penta means five.
General|How many degrees are there in a right angle?|90|45|180|60|A right angle is a quarter turn, which is 90 degrees.
General|How many degrees are in a full circle?|360|180|270|100|A full turn is 360 degrees.
General|What is the next prime number after 7?|11|9|10|13|9 is 3 times 3 and 10 is 2 times 5, so 11 is next.
General|What is 12 multiplied by 12?|144|124|122|148|Twelve times twelve is 144.
General|What is the square root of 81?|9|8|7|11|Nine times nine is 81.
General|How many continents are there?|Seven|Five|Six|Eight|The continents are Africa, Antarctica, Asia, Australia, Europe, North America and South America.
General|Which is the longest day of the year in the northern hemisphere?|The June solstice|The March equinox|The December solstice|The September equinox|The June solstice has the most daylight in the north.
General|What are the three primary colours of paint in traditional art lessons?|Red, yellow and blue|Red, green and blue|Orange, green and purple|Black, white and grey|Mixing red, yellow and blue makes many other colours.
General|What colour do you get when you mix blue and yellow?|Green|Orange|Purple|Brown|Blue and yellow paint make green.
General|What colour do you get when you mix red and white?|Pink|Orange|Purple|Brown|Red mixed with white makes pink.
General|What is the currency of Japan?|The yen|The won|The yuan|The ringgit|Japan uses the yen.
General|What is the currency of the United Kingdom?|The pound sterling|The euro|The dollar|The franc|The UK uses the pound sterling.
General|What is the currency used in most of the European Union?|The euro|The pound|The krona|The franc|Twenty countries use the euro as of the 2020s.
General|What language is mainly spoken in Brazil?|Portuguese|Spanish|English|French|Brazil was colonised by Portugal.
General|What language is mainly spoken in Egypt?|Arabic|French|Turkish|Persian|Arabic is the official language of Egypt.
General|Which language has the most native speakers in the world?|Mandarin Chinese|English|Spanish|Hindi|Mandarin has more native speakers than any other language.
General|What is the name for a person who writes books?|Author|Editor|Publisher|Librarian|An author writes books.
General|Who wrote the play Romeo and Juliet?|William Shakespeare|Charles Dickens|Jane Austen|Mark Twain|Shakespeare wrote it in the 1590s.
General|Who wrote the novel Pride and Prejudice?|Jane Austen|Charlotte Bronte|Emily Dickinson|Virginia Woolf|Austen published it in 1813.
General|Who wrote the Harry Potter books?|J. K. Rowling|Roald Dahl|J. R. R. Tolkien|C. S. Lewis|The first book was published in 1997.
General|Who wrote The Lord of the Rings?|J. R. R. Tolkien|C. S. Lewis|Roald Dahl|George R. R. Martin|Tolkien published it in the 1950s.
General|Who wrote Charlie and the Chocolate Factory?|Roald Dahl|Dr. Seuss|Enid Blyton|Beatrix Potter|Roald Dahl wrote it in 1964.
General|Who painted the Mona Lisa?|Leonardo da Vinci|Vincent van Gogh|Pablo Picasso|Claude Monet|Leonardo painted it in the early 1500s.
General|Who painted The Starry Night?|Vincent van Gogh|Claude Monet|Salvador Dali|Rembrandt|Van Gogh painted it in 1889.
General|Which museum in Paris holds the Mona Lisa?|The Louvre|The Orsay|The Pompidou|The Rodin|The Louvre is the most visited museum in the world.
General|Who composed the Ninth Symphony, which includes Ode to Joy?|Ludwig van Beethoven|Wolfgang Mozart|Johann Bach|Franz Schubert|Beethoven finished the symphony in 1824.
General|How many strings does a standard violin have?|Four|Six|Five|Three|A violin has four strings.
General|How many strings does a standard guitar have?|Six|Four|Five|Eight|A standard guitar has six strings.
General|How many keys does a standard piano have?|88|76|66|100|A full piano has 52 white keys and 36 black keys.
General|How many players are on each side of a chess board at the start?|Sixteen pieces|Twelve pieces|Eight pieces|Twenty pieces|Each side starts with 16 pieces.
General|How many squares are on a chessboard?|64|60|72|81|A chessboard is an 8 by 8 grid.
General|What is the most common blood group in the world?|O|A|B|AB|Type O is the most common worldwide.
General|How many hours are there in a day?|24|12|20|48|A day is made of 24 hours.
General|How many days are in a week?|Seven|Five|Six|Ten|A week has seven days.
General|What is the name of the festival of lights celebrated by Hindus, Sikhs and Jains?|Diwali|Holi|Eid|Hanukkah|Diwali is the festival of lights.
General|Which holiday is celebrated on 25 December?|Christmas|Easter|Thanksgiving|Halloween|Christmas Day is on 25 December.
General|Which holiday is celebrated on 31 October?|Halloween|Christmas|Valentine's Day|New Year's Eve|Halloween is on 31 October.
General|Which holiday is celebrated on 14 February?|Valentine's Day|Halloween|Easter|Mother's Day|Valentine's Day is on 14 February.
General|What is the name for the number of years in a decade?|Ten|Five|One hundred|Twenty|A decade is ten years.
General|What do the letters AM stand for in time?|Ante meridiem|After midday|Always morning|Alpha minute|Ante meridiem is Latin for before midday.
General|Which month comes after August?|September|July|October|November|September follows August.
General|Which month has the fewest days?|February|April|June|November|February has 28 days, or 29 in a leap year.
General|What is the name for a word that means the opposite of another?|Antonym|Synonym|Homonym|Acronym|An antonym is a word of opposite meaning.
General|What is the name for a word that means the same as another?|Synonym|Antonym|Acronym|Prefix|A synonym has the same or nearly the same meaning.
General|How many letters are in the English alphabet?|26|24|25|28|The English alphabet has 26 letters.
General|What is the plural of the word mouse for the animal?|Mice|Mouses|Mouse|Meese|The plural of mouse is mice.
General|What is the opposite of the word ascend?|Descend|Rise|Climb|Float|To descend is to go down.
General|What is a shape with three sides called?|A triangle|A square|A pentagon|A circle|Tri means three.
General|Which instrument has black and white keys?|The piano|The guitar|The drum|The flute|The piano has black and white keys.
General|Which bird is the symbol of peace?|The dove|The eagle|The owl|The swan|The dove with an olive branch stands for peace.
General|What is the traditional gift for a 50th wedding anniversary?|Gold|Silver|Diamond|Pearl|The golden anniversary is the 50th.
General|What is the national animal of Australia, shown on its coat of arms with the emu?|The kangaroo|The koala|The wombat|The platypus|The kangaroo and emu appear on the Australian coat of arms.
`;
  // The correct answer goes in slot (i * 7 + floor(i / 4)) mod 4, so the right answer is not always in the same place.
  const questions = RAW.trim().split('\n').map((line, i) => {
    const [cat, q, right, w1, w2, w3, why] = line.split('|').map((s) => s.trim());
    const a = (i * 7 + Math.floor(i / 4)) % 4, o = [w1, w2, w3];
    o.splice(a, 0, right);
    return { cat, q, o, a, why };
  });
  const api = { questions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NotchTriviaQuestions = api;
})();
