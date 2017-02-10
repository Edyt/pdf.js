function getMCID(orignode, offset) {
  var node = orignode, divs;
  if (node.nodeType !== 1) {
    node = node.parentNode;
  }
  while (node && node.getAttribute && !node.getAttribute('mcid')) {
    node = node.parentNode
  }
  if(!node.getAttribute) {
    node = orignode.childNodes[offset];
    if(!node){
      //end of page
      divs = orignode.querySelectorAll('div[mcid]');
      if(divs.length){
        node = divs[divs.length - 1];
        offset = node.textContent.length;
      }
    } else {
      divs = node.querySelectorAll('div[mcid]');
      node = divs[0];
      offset = 0;
    }
    if(node && !node.getAttribute('mcid')){
      return null;
    }
  }
  return [node, offset];
}
function getMCEndPoint(node, offset) {
  var mcidnode = getMCID(node, offset);
  offset = mcidnode[1];
  mcidnode = mcidnode[0];
  if (mcidnode) {
    if(/^\s*$/.test(mcidnode.textContent)){
      //all spaces mcid are not created in pdf.js, find a neighbor which is not empty
      var attemps = [[mcidnode.previousSibling, -1], [mcidnode.nextSibling, 0]];
      if(offset) {
        //swap the 2 elements in the attempts list
        attemps.push(attemps.shift());
      }
      attemps.every(function(attemp){
        var node = attemp[0], localoffset = attemp[1];
        if(node && node.getAttribute){
          if(node.getAttribute('mcid')){
            if(localoffset<0){
              offset = node.firstChild.length;
            }else{
              offset = localoffset;
            }
            mcidnode = node;
            return false;
          }
        }
        return true;
      });
    }
    var mcid = mcidnode.getAttribute('mcid');
    mcid = mcid.split('/');
    if (mcidnode.getAttribute('startoffset')) {
      offset += parseInt(mcidnode.getAttribute('startoffset'));
    }
    return {page: parseInt(mcid[0]),
      mcid:parseInt(mcid[1]), offset: offset};
  }
}
function getMCRange() {
  var domrange = getSelection().getRangeAt(0), range;
  if (!domrange.collapsed) {
    range = {};
    range.start = getMCEndPoint(domrange.startContainer, domrange.startOffset);
    if (!range.start) {
      console.error('Failed to obtain range start position');
      return;
    }
    range.end = getMCEndPoint(domrange.endContainer, domrange.endOffset);
    if (!range.end) {
      console.error('Failed to obtain range endposition');
      return;
    }
  }
  return range;
}

var forbiddenClauses = {
  "in the spirit of": {
    "type": "error",
    "message": "Lack of clarity"
  },
  "spirit of invention": {
    "type": "error",
    "message": "Lack of clarity"
  },
  "approximately": {
    "type": "warning",
    "message": "Is this clear?"
  },
  "about": {
    "type": "warning",
    "message": "Is this clear?"
  },
  "substantially": {
    "type": "warning",
    "message": "Is this clear?"
  }
};

var forbiddenRegexes = {
  "<p\\s[^>]*?>(<span\\s[^>]*?>[A-Z\\s]+</span>)+</p>": { // ALL UPPERCASE PARAGRAPH // TODO unicode support
    "type": "warning",
    "message": "Should paragraph be a heading?"
  }
}

function getRegexForClause(clause) {
  var tokens = clause.split(" ");
  var result = "";
  for (var i = 0; i < tokens.length; i++) {
    result = result + "<span\\s[^>]*?>".concat(tokens[i]).concat("</span>");
    if (i != tokens.length - 1) {
      result = result + "<span\\s[^>]*?>\\s+</span>";
    }
  }
  return new RegExp(result, 'gi');
}

function validateHTML(pdfViewer) {
  Object.keys(forbiddenClauses).forEach(function(clause) {
    applyForbiddenClause(clause, forbiddenClauses[clause], pdfViewer);
  });
  Object.keys(forbiddenRegexes).forEach(function(regexString) {
    var regex = new RegExp(regexString, 'g');
    applyForbiddenRegex(regex, forbiddenRegexes[regexString], pdfViewer);
  });
  hideNonSnippetContent();
}

const HIDDEN_SNIPPET_CLASS = "snippet-hidden";

function hideNonSnippetContent() {
  var nodesToHide = document.querySelectorAll("section > :not([snippet='true'])");
  hideNodes(nodesToHide);
}

function hideNodes(elementsToHide) {
  for (var i = 0; i < elementsToHide.length; i++) {
    var element = elementsToHide[i];
    element.classList.add(HIDDEN_SNIPPET_CLASS);
    if (!element.nextSibling || isSnippet(element.nextSibling)) {
      var par = document.createElement("p");
      par.classList.add("expand-control");
      par.addEventListener("click", expandAllNodesUpToNextSnippet, false);
      element.parentNode.insertBefore(par, element.nextSibling);
    }
  }
}

function isSnippet(element) {
  return element.attributes.getNamedItem("snippet") !== null;
}

function expandAllNodesUpToNextSnippet(e) {
  var element = e.currentTarget;
  while (element != null && !isSnippet(element)) {
    element.classList.remove(HIDDEN_SNIPPET_CLASS);
    element.classList.add("snippet-shown");
    element.addEventListener("click", hideBetweenSnippets, false);
    element = element.previousSibling;
  }
  e.currentTarget.parentNode.removeChild(e.currentTarget);
}

function hideBetweenSnippets(e) {
  var startElement = e.currentTarget;
  var nodes = [];
  nodes.push(startElement);
  var upElement = startElement.previousSibling;
  while (upElement && !isSnippet(upElement)) {
    nodes.push(upElement);
    upElement = upElement.previousSibling;
  }
  var downElement = startElement.nextSibling;
  while (downElement && !isSnippet(downElement)) {
    nodes.push(downElement);
    downElement = downElement.nextSibling;
  }
  hideNodes(nodes);
}

function applyForbiddenClause(clause, problemDescription, pdfViewer) {
  var forbiddenRegex = getRegexForClause(clause);
  applyForbiddenRegex(forbiddenRegex, problemDescription, pdfViewer);
}

var applyProblemClassToElement = function (problemType, element) {
  if (problemType === "error") {
    element.classList.add("validation-error");
  } else {
    element.classList.add("validation-warning");
  }
};

var annotateAsSnippet = function (paragraphElement) {
  paragraphElement.setAttribute("snippet", "true");
};

function applyForbiddenRegex(forbiddenRegex, problemDescription, pdfViewer) {
  var problemType = problemDescription["type"];
  var problemMessage = problemDescription["message"];
  var contents = document.documentElement.innerHTML;
  var matches = contents.match(forbiddenRegex);
  if (!matches) {
    return;
  }
  for (var i = 0; i < matches.length; i++) {
    var match = matches[i];
    var mcidRegex = /mcid="[\d/]+"/g;
    var mcIds = match.match(mcidRegex);
    var paragraphElement = null;
    for (var j = 0; j < mcIds.length; j++) {
      var selector = '[' + mcIds[j] + ']';
      var elements = document.querySelectorAll(selector);
      var element = elements[0];
      applyProblemClassToElement(problemType, element);
      paragraphElement = element.parentElement;
      annotateAsSnippet(paragraphElement);
      pdfViewer.markValidationError(mcIds[j], problemType);
    }
    if (paragraphElement) {
      addMessage(paragraphElement, problemType, problemMessage);
    }
  }
}

function addMessage(paragraphElement, problemType, problemMessage) {
  var par = document.createElement("p");
  annotateAsSnippet(par);
  applyProblemClassToElement(problemType, par);
  par.textContent = problemMessage;
  if (paragraphElement.nextSibling) {
    paragraphElement.parentNode.insertBefore(par, paragraphElement.nextSibling);
  } else {
    paragraphElement.parentNode.appendChild(par);
  }
}
