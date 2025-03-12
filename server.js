const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { NlpManager } = require('node-nlp');
const fs = require('fs');
const { parse } = require('csv-parse');
const session = require('express-session');
const stringSimilarity = require('string-similarity'); // Install using npm install string-similarity

const app = express();

// Middleware setup
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve the animation GIF
app.get('/animation.gif', (req, res) => {
  res.sendFile(path.join(__dirname, 'animation.gif'));
});

app.use(session({
  secret: 'my-secret-key', // Change this for production
  resave: false,
  saveUninitialized: true,
}));

// --------------------
// AI Agent Setup using node-nlp
// --------------------
const manager = new NlpManager({ languages: ['en'] });

manager.addDocument('en', 'hello', 'greetings.hello');
manager.addDocument('en', 'hi', 'greetings.hello');
manager.addDocument('en', 'hey', 'greetings.hello');
manager.addDocument('en', 'how are you', 'greetings.howareyou');
manager.addDocument('en', 'what is your name', 'agent.name');
manager.addDocument('en', 'who are you', 'agent.name');
manager.addDocument('en', 'help', 'agent.help');
manager.addDocument('en', 'what can you do', 'agent.help');

manager.addAnswer('en', 'greetings.hello', 'Hello! Welcome to MENIITAI Chatbot.<br>Instructions: Please select your class (6 to 12) by clicking one of the buttons below.');
manager.addAnswer('en', 'greetings.howareyou', 'I am just a bot, but I am here to help you!');
manager.addAnswer('en', 'agent.name', 'I am an AI agent built to assist you.');
manager.addAnswer('en', 'agent.help', 'You can ask me any questions, or type "ncert" to explore NCERT topics.');

(async () => {
  await manager.train();
  manager.save();
  console.log('NLP Manager trained.');
})();

let ncertData = [];
fs.createReadStream('NCERT_dataset.csv')
  .pipe(parse({ columns: true }))
  .on('data', (row) => {
    ncertData.push(row);
  })
  .on('end', () => {
    console.log('NCERT dataset loaded.');
  });

const TOPICS_PER_PAGE = 5;

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Reset session state
app.post('/reset', (req, res) => {
  req.session.userState = {};
  res.json({ reply: "Chat session reset." });
});

// Chatbot logic
app.post('/chat', async (req, res) => {
  let userMessage = req.body.message;
  let userState = req.session.userState || {};

  // Start with a welcome message if there's no session state
  if (!userState.step) {
    userState.step = 'welcome';
    req.session.userState = userState;
    return res.json({ reply: `<div class="greeting-box">👋 Welcome to MENIITAI Chatbot!<br>
      📌 <b>Instructions:</b><br>
      - Select your class (6 to 12) by clicking one of the buttons below.<br>
      - Choose a topic to begin answering questions.<br>
      - Earn points for correct answers! 🎯
      </div>` });
  }

  // Class selection step
  if (userState.step === 'welcome') {
    if (userMessage.trim() === "") {
      return res.json({ reply: `<div class="greeting-box">📌 Please select your class (6 to 12) using the buttons below.</div>` });
    }
    if (/^(6|7|8|9|10|11|12)$/.test(userMessage.trim())) {
      userState.selectedClass = userMessage.trim();
      userState.step = 'select_topic';
      const topics = [...new Set(ncertData.filter(row => row.grade === userState.selectedClass).map(row => row.Topic))];
      if (topics.length === 0) {
        req.session.userState = {};
        return res.json({ reply: `<div class="error-box">No topics found for this class.</div>` });
      }
      userState.topics = topics;
      userState.currentPage = 0;
      req.session.userState = userState;
      return res.json({ reply: generateTopicPage(userState) });
    } else {
      return res.json({ reply: `<div class="error-box">❌ Invalid class. Please select a class between 6 and 12.</div>` });
    }
  }

  // Topic selection step
  if (userState.step === 'select_topic') {
    if (userMessage.trim().toLowerCase() === 'next') {
      userState.currentPage++;
      if (userState.currentPage * TOPICS_PER_PAGE >= userState.topics.length) {
        userState.currentPage--;
        return res.json({ reply: `<div class="error-box">🚫 No more topics available.</div>${generateTopicPage(userState)}` });
      }
      return res.json({ reply: generateTopicPage(userState) });
    }
    let topicIndex = parseInt(userMessage.trim()) - 1;
    if (!isNaN(topicIndex) && topicIndex >= 0 && topicIndex < userState.topics.length) {
      userState.selectedTopic = userState.topics[topicIndex];
      userState.step = 'ask_question';
      userState.questions = ncertData.filter(row => row.grade === userState.selectedClass && row.Topic === userState.selectedTopic);
      if (userState.questions.length === 0) {
        req.session.userState = {};
        return res.json({ reply: `<div class="error-box">No questions found for this topic.</div>` });
      }
      userState.questionIndex = 0;
      req.session.userState = userState;
      return res.json({ reply: `<div class="question-box">🔎 <b>Question:</b> ${userState.questions[0].Question}</div>` });
    } else {
      return res.json({ reply: `<div class="error-box">⚠️ Invalid input. Please select a topic number.</div>` });
    }
  }

  // Question-answering step with fuzzy matching
  if (userState.step === 'ask_question') {
    let currentQuestion = userState.questions[userState.questionIndex];

    let correctAnswer = currentQuestion.Answer.trim().toLowerCase();
    let userAnswer = userMessage.trim().toLowerCase();
    let similarity = stringSimilarity.compareTwoStrings(userAnswer, correctAnswer);
    let responseText = "";

    if (similarity > 0.5 || correctAnswer.includes(userAnswer) || userAnswer.includes(correctAnswer.split(":")[0])) {
      responseText = `<div class="correct-box">✅ Correct! 🎉</div>`;
    } else {
      responseText = `<div class="incorrect-box">❌ Incorrect!<br>The correct answer is: <b>${currentQuestion.Answer}</b></div>`;
    }

    userState.questionIndex++;
    if (userState.questionIndex < userState.questions.length) {
      responseText += `<div class="next-question-box">➡️ Next Question: ${userState.questions[userState.questionIndex].Question}</div>`;
      req.session.userState = userState;
      return res.json({ reply: responseText });
    } else {
      req.session.userState = {};
      return res.json({ reply: `${responseText}<div class="next-question-box">🎯 End of questions for this topic.</div>` });
    }
  }

  let aiResponse = await manager.process('en', userMessage);
  let reply = aiResponse.answer || "I'm sorry, I didn't understand that. Could you please rephrase?";
  return res.json({ reply: `<div class="ai-box">${reply}</div>` });
});

function generateTopicPage(userState) {
  const topics = userState.topics;
  const currentPage = userState.currentPage;
  const start = currentPage * TOPICS_PER_PAGE;
  const pageTopics = topics.slice(start, start + TOPICS_PER_PAGE);

  let html = `<div class="topic-box">📚 <b>Select a topic (Page ${currentPage + 1}):</b></div><div class="topics-container">`;
  
  pageTopics.forEach((topic, index) => {
    html += `<button onclick="sendMessage('${index + 1}')" class="topic-button">${index + 1}. ${topic}</button>`;
  });

  html += `</div>`;

  if ((currentPage + 1) * TOPICS_PER_PAGE < topics.length) {
    html += `<button onclick="sendMessage('next')" class="next-btn">➡️ Show More</button>`;
  }

  return html;
}


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
