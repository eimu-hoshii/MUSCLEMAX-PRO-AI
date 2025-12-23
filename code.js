/**
 * MuscleMax Backend Logic
 */

const SS = SpreadsheetApp.getActiveSpreadsheet();
const SHEET_NAME = "Log";

function doGet() {
  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle('MuscleMax')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// データ保存
function saveWorkout(dataList) {
  const sheet = getOrInitSheet();
  // 日時, 部位, 種目, 重量, 回数, セット, スコア, メモ
  const rows = dataList.map(d => {
    // 日時は文字列としてそのまま保存 (ISO形式)
    // 見やすくフォーマットする場合はここで加工
    const dateObj = new Date(d.date);
    const dateStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
    return [dateStr, d.bodyPart, d.exercise, d.weight, d.reps, d.sets, d.score, d.memo];
  });
  
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
  }
  return "Success";
}

// 履歴取得
function getHistoryJSON() {
  const sheet = getOrInitSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return JSON.stringify([]);
  
  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  const history = data.map(row => ({
    dateStr: row[0], // A列
    bodyPart: row[1],
    exercise: row[2],
    weight: row[3],
    reps: row[4],
    sets: row[5],
    score: row[6],
    memo: row[7]
  })).reverse(); // 新しい順
  
  return JSON.stringify(history.slice(0, 300)); // 最新300件
}

// Gemini API連携
function callGeminiAPI(userPrompt, frontendApiKey) {
  const apiKey = frontendApiKey || PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  
  if (!apiKey) return JSON.stringify([{exercise: "APIキー未設定", weight:0, reps:0, sets:0, memo:"コード内のUSER_CONFIGを確認してください", bodyPart:"その他"}]);

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
  
  // システムプロンプトでJSON出力を強制
  const systemInstruction = `
    あなたはプロのトレーナーです。ユーザーの条件に基づき、最適な筋トレメニューを作成してください。
    回答は必ず以下のキーをすべて含みJSON配列形式のみを出力してください。1つでも欠けてはいけません。Markdown記法や余計な解説は一切不要です。
    必須キー:
    - bodyPart (string)
    - exercise (string, 空文字不可)
    - weight (number)
    - reps (number)
    - sets (number)
    - memo (string)

    exercise が不明な場合でも "不明な種目" と必ず文字列を入れてください。
    
    フォーマット:
    [
      {
        "bodyPart": "部位名(胸,背中,脚,肩,腕,腹,その他)",
        "exercise": "種目名",
        "weight": 数値(kg 推奨値),
        "reps": 数値(回数),
        "sets": 数値(セット数),
        "memo": "ワンポイントアドバイス"
      }
    ]
  `;

  const payload = {
    "contents": [{
      "parts": [{ "text": userPrompt }]
    }],
    "systemInstruction": {
      "parts": [{ "text": systemInstruction }]
    },
    "generationConfig": {
      "temperature": 0.7,
      "responseMimeType": "application/json"
    }
  };

  try {
    const options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };
    const response = UrlFetchApp.fetch(apiUrl, options);
    const json = JSON.parse(response.getContentText());
    
    if (json.candidates && json.candidates[0].content) {
      let text = json.candidates[0].content.parts[0].text;
      // 万が一Markdownコードブロックが含まれていたら除去
      text = text.replace(/```json/g, "").replace(/```/g, "").trim();
      return text;
    } else {
      // エラー詳細を返すように少し変更
      throw new Error(json.error ? json.error.message : "AIからの応答が不正です");
    }
  } catch (e) {
    return JSON.stringify([{exercise: "エラー発生", weight:0, reps:0, sets:0, memo: e.toString(), bodyPart:"その他"}]);
  }
}

function getOrInitSheet() {
  let sheet = SS.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = SS.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, 8).setValues([["日時", "部位", "種目名", "重量", "回数", "セット数", "スコア", "メモ"]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
