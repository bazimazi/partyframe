/**
 * The question bank. Plain data, so a real game would load it from a file or
 * a service; here it lives in code so the example has no assets.
 *
 * `answer` is the index into `choices`. The bank is shuffled per match with the
 * seeded RNG, so a test can pin the questions it expects.
 */

export interface QuizQuestion {
  text: string;
  choices: readonly [string, string, string, string];
  answer: 0 | 1 | 2 | 3;
}

export const QUESTIONS: readonly QuizQuestion[] = [
  {
    text: "Which planet is known as the Red Planet?",
    choices: ["Venus", "Mars", "Jupiter", "Mercury"],
    answer: 1,
  },
  {
    text: "How many legs does a spider have?",
    choices: ["Six", "Eight", "Ten", "Twelve"],
    answer: 1,
  },
  {
    text: "What is the largest ocean on Earth?",
    choices: ["Atlantic", "Indian", "Pacific", "Arctic"],
    answer: 2,
  },
  {
    text: "Which gas do plants absorb from the air?",
    choices: ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"],
    answer: 2,
  },
  {
    text: "What is the capital of Japan?",
    choices: ["Osaka", "Kyoto", "Seoul", "Tokyo"],
    answer: 3,
  },
  { text: "How many continents are there?", choices: ["Five", "Six", "Seven", "Eight"], answer: 2 },
  {
    text: "What is the hardest natural substance?",
    choices: ["Gold", "Iron", "Diamond", "Quartz"],
    answer: 2,
  },
  {
    text: "Which animal is the tallest in the world?",
    choices: ["Elephant", "Giraffe", "Ostrich", "Camel"],
    answer: 1,
  },
  {
    text: "What is H2O more commonly called?",
    choices: ["Salt", "Water", "Hydrogen", "Bleach"],
    answer: 1,
  },
  {
    text: "How many sides does a hexagon have?",
    choices: ["Five", "Six", "Seven", "Eight"],
    answer: 1,
  },
  {
    text: "Which instrument has 88 keys?",
    choices: ["Guitar", "Violin", "Piano", "Flute"],
    answer: 2,
  },
  {
    text: "What is the largest mammal?",
    choices: ["Elephant", "Blue whale", "Hippo", "Giraffe"],
    answer: 1,
  },
  {
    text: "Which country is home to the kangaroo?",
    choices: ["Brazil", "South Africa", "Australia", "India"],
    answer: 2,
  },
  {
    text: "What is the freezing point of water in Celsius?",
    choices: ["0°", "32°", "100°", "-10°"],
    answer: 0,
  },
  {
    text: "Which color do you get by mixing blue and yellow?",
    choices: ["Purple", "Orange", "Green", "Brown"],
    answer: 2,
  },
  { text: "How many minutes are in two hours?", choices: ["60", "90", "120", "150"], answer: 2 },
  {
    text: "What is the closest star to Earth?",
    choices: ["Sirius", "The Sun", "Polaris", "Alpha Centauri"],
    answer: 1,
  },
  {
    text: "Which is the longest river in Africa?",
    choices: ["Congo", "Niger", "Zambezi", "Nile"],
    answer: 3,
  },
  { text: "What do bees make?", choices: ["Milk", "Honey", "Silk", "Wax paper"], answer: 1 },
  {
    text: "How many strings does a standard guitar have?",
    choices: ["Four", "Five", "Six", "Seven"],
    answer: 2,
  },
  {
    text: "Which organ pumps blood around the body?",
    choices: ["Lungs", "Liver", "Heart", "Kidney"],
    answer: 2,
  },
  { text: "What is the square root of 81?", choices: ["7", "8", "9", "11"], answer: 2 },
  {
    text: "Which is the smallest planet in our solar system?",
    choices: ["Mars", "Mercury", "Pluto", "Venus"],
    answer: 1,
  },
  {
    text: "In which sport would you perform a slam dunk?",
    choices: ["Tennis", "Basketball", "Volleyball", "Golf"],
    answer: 1,
  },
  {
    text: "What is the main language spoken in Brazil?",
    choices: ["Spanish", "Portuguese", "French", "Italian"],
    answer: 1,
  },
  { text: "How many days are in a leap year?", choices: ["364", "365", "366", "367"], answer: 2 },
  {
    text: "Which metal is liquid at room temperature?",
    choices: ["Iron", "Mercury", "Copper", "Silver"],
    answer: 1,
  },
  {
    text: "What is the tallest mountain on Earth?",
    choices: ["K2", "Kilimanjaro", "Everest", "Denali"],
    answer: 2,
  },
  {
    text: "Which bird is known for its colourful tail feathers?",
    choices: ["Penguin", "Peacock", "Sparrow", "Owl"],
    answer: 1,
  },
  { text: "What is 15 × 4?", choices: ["45", "50", "60", "75"], answer: 2 },
  {
    text: "Which sea creature has three hearts?",
    choices: ["Shark", "Octopus", "Dolphin", "Jellyfish"],
    answer: 1,
  },
  {
    text: "What is the currency of the United Kingdom?",
    choices: ["Euro", "Dollar", "Pound", "Franc"],
    answer: 2,
  },
  {
    text: "Which desert is the largest hot desert?",
    choices: ["Gobi", "Sahara", "Kalahari", "Mojave"],
    answer: 1,
  },
  {
    text: "How many bones does an adult human have?",
    choices: ["106", "186", "206", "306"],
    answer: 2,
  },
  {
    text: "Which fruit is known for keeping the doctor away?",
    choices: ["Banana", "Apple", "Orange", "Pear"],
    answer: 1,
  },
  { text: "What is the chemical symbol for gold?", choices: ["Go", "Gd", "Au", "Ag"], answer: 2 },
  {
    text: "Which shape has no corners?",
    choices: ["Square", "Triangle", "Circle", "Pentagon"],
    answer: 2,
  },
  {
    text: "How many players are on a football (soccer) team on the pitch?",
    choices: ["9", "10", "11", "12"],
    answer: 2,
  },
  {
    text: "What is the largest country by area?",
    choices: ["Canada", "China", "Russia", "USA"],
    answer: 2,
  },
  {
    text: "Which of these is a primary colour of light?",
    choices: ["Green", "Orange", "Purple", "Pink"],
    answer: 0,
  },
];
