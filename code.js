function doGet() {
  var output = HtmlService.createTemplateFromFile('index').evaluate();
  output.addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0');
  output.setTitle('MuscleMax Pro AI');
  return output;
}

// 権限承認用
function authCheck() {
  try {
    UrlFetchApp.fetch("https://www.google.com");
    console.log("権限確認OK");
  } catch (e) {
    console.log("エラー: " + e.toString());
  }
}

// Gemini API
function generateWorkoutMenu(apiKey, duration, parts, equipment, height, weight, freeText) {
  if (!apiKey) return { success: false, message: "APIキーが設定されていません" };
  
  let userInfo = "";
  if (height) userInfo += `身長: ${height}cm, `;
  if (weight) userInfo += `体重: ${weight}kg`;
  
  const prompt = `
    あなたは実務経験豊富なプロのジムトレーナーです。以下のユーザー情報と条件を厳密に守り、筋肥大を目的とした筋トレメニューを作成し、JSON配列のみを返してください。
    
    【ユーザー】${userInfo || "未設定"}
    【条件】部位:${parts.join(',')}, 時間:${duration}分以内, 使用可能な器具:${equipment}, 目的:筋肥大（コンパウンド種目は6〜12回、3〜4セット、インターバル1〜3分。アイソレーション種目12〜15回、3〜5セット、インターバル1〜3分で限界が来る強度を基本とする）
    【要望】${freeText || "なし"}
    【作成ルール】- 各部位につき2〜4種目程度にまとめる - コンパウンド種目を優先し、必要に応じてアイソレーション種目を組み合わせる - 合計トレーニング時間が指定時間を超えないよう配慮する - 重量（weight）は「目安重量」として現実的な数値を設定する - メモ（note）にはフォーム意識・休憩時間・注意点などを簡潔に記載する  
    【出力形式】
    [{"part":"部位","exercise":"種目","weight":kg数値,"reps":回数,"sets":セット数,"note":"メモ"}]
    ※文章・説明・マークダウン・コードブロック不要。JSONのみ出力。
  `;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    
    if (json.error) return { success: false, message: "API Error: " + json.error.message };
    if (!json.candidates) return { success: false, message: "AI応答なし" };

    const text = json.candidates[0].content.parts[0].text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return { success: false, message: "生成エラー" };
    
    return { success: true, menu: JSON.parse(jsonMatch[0]) };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

// データ保存（日付を文字列で保存するように修正）
function saveWorkouts(dataList) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    // シート名が違っても1番目のシートを使う安全策
    var sheet = ss.getSheetByName('Data') || ss.getSheets()[0];
    
    if (!dataList || dataList.length === 0) return { success: false, message: "データがありません" };

    var rows = [];
    var date = new Date();
    // 【修正】日付を文字列として確定させる（表示トラブル防止）
    var dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');

    dataList.forEach(function(data) {
      var oneRM = 0;
      if(data.weight > 0 && data.reps > 0) {
        oneRM = Math.round(data.weight * (1 + data.reps / 40) * 10) / 10;
      }
      
      rows.push([
        dateStr, // 文字列で保存
        data.part,
        data.exercise,
        data.weight,
        data.reps,
        data.sets, 
        oneRM,
        data.note || ""
      ]);
    });

    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    return { success: true, message: "記録しました" };
  } catch(e) {
    return { success: false, message: e.toString() };
  }
}

// 履歴削除
function deleteLog(rowIndex) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Data') || ss.getSheets()[0];
    sheet.deleteRow(rowIndex);
    return { success: true };
  } catch(e) {
    return { success: false, message: e.toString() };
  }
}

// 履歴取得（全件取得・Date型ケア）
function getHistory() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Data') || ss.getSheets()[0];
    var lastRow = sheet.getLastRow();
    
    if (lastRow < 2) return [];
    
    // 全データを取得
    // ※データ量が増えると遅くなるため、本来は制限すべきだがUX優先で全件取得
    var startRow = 2; 
    var range = sheet.getRange(startRow, 1, lastRow - 1, 8);
    var values = range.getValues();
    
    var result = values.map(function(row, index) {
      // 日付列(0)がDateオブジェクトなら文字列化して返す（クライアント側の負担減）
      var dateVal = row[0];
      if (dateVal instanceof Date) {
        dateVal = Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
      }
      // 配列の中身を書き換えて新しい配列として返す
      var cleanRow = [dateVal, row[1], row[2], row[3], row[4], row[5], row[6], row[7]];
      
      return {
        rowIndex: startRow + index,
        data: cleanRow
      };
    }).filter(function(item) {
      // 日付がないデータは除外
      return item.data[0] !== "";
    });
    
    return result.reverse(); // 新しい順
  } catch(e) {
    return []; // エラー時は空配列
  }
}

// 種目別データ取得 (修正版: volume追加 + 日付正規化)
function getExerciseProgress(exerciseName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Data') || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var result = [];

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][2]).trim() == String(exerciseName).trim()) {
      var dateVal = data[i][0];
      
      // 日付を「必ず」JSで扱いやすい形にする（ISO文字列 or ミリ秒）
      var dateObj = (dateVal instanceof Date) ? dateVal : new Date(String(dateVal).replace(/-/g,'/'));
      var dateOut = isNaN(dateObj.getTime())
        ? String(dateVal) // 最悪文字列のまま
        : dateObj.toISOString(); // ←おすすめ（確実にパースできる）

      var w = Number(data[i][3]) || 0;
      var r = Number(data[i][4]) || 0;
      var s = Number(data[i][5]) || 0;

      result.push({
        date: dateOut,
        weight: w,
        reps: r,
        sets: s,
        oneRM: Number(data[i][6]) || 0,
        volume: w * r * s // ★追加：総負荷量
      });
    }
  }
  return result;
}

// 分析用データ
function getBodyPartStats() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Data') || ss.getSheets()[0];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  
  var parts = sheet.getRange(2, 2, lastRow - 1, 1).getValues().flat();
  var sets = sheet.getRange(2, 6, lastRow - 1, 1).getValues().flat();
  
  var stats = {};
  for(var i=0; i<parts.length; i++) {
    var p = parts[i];
    var s = Number(sets[i]) || 1;
    if(!stats[p]) stats[p] = 0;
    stats[p] += s;
  }
  return stats;
}

// 種目リスト
function getExerciseList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Data') || ss.getSheets()[0];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  var data = sheet.getRange(2, 2, lastRow - 1, 2).getValues();
  var uniqueMap = new Map();
  
  data.forEach(function(row) {
    var part = row[0];
    var exercise = row[1];
    if (part && exercise) {
      var key = part + "_" + exercise;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, { part: part, exercise: exercise });
      }
    }
  });
  
  return Array.from(uniqueMap.values());
}
