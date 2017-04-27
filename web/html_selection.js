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
  var sel = getSelection();
  if (!sel.rangeCount) {
    return;
  }
  var domrange = sel.getRangeAt(0), range;
  if (!domrange.collapsed || sel.rangeCount > 1) {
    range = {};
    range.start = getMCEndPoint(domrange.startContainer, domrange.startOffset);
    if (!range.start) {
      console.error('Failed to obtain range start position');
      return;
    }
    domrange = sel.getRangeAt(sel.rangeCount - 1);
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
const SHOWN_SNIPPET_CLASS = "snippet-shown";

function hideNonSnippetContent() {
  var nodesToHide = document.querySelectorAll("section > p:not([snippet='true']), section li:not([snippet='true'])");
  hideNodes(nodesToHide);
}

function hideNodes(elementsToHide) {
  for (var i = 0; i < elementsToHide.length; i++) {
    var element = elementsToHide[i];
    element.classList.add(HIDDEN_SNIPPET_CLASS);
    element.classList.remove(SHOWN_SNIPPET_CLASS);
    if ( (!element.nextSibling  && !isListItemElement(element)) || (element.nextSibling && isSnippet(element.nextSibling)) ) {
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

var isListItemElement = function (element) {
  return element.tagName.toLowerCase() === "li";
};

var isListElement = function (element) {
  return element.tagName.toLowerCase() === "l";
}

function expandAllNodesUpToNextSnippet(e) {
  e.preventDefault();
  e.stopPropagation();
  var element = e.currentTarget;
  while (element != null && !isSnippet(element)) {
    if (isListElement(element)) {
      element = element.lastChild;
      continue;
    }
    element.classList.remove(HIDDEN_SNIPPET_CLASS);
    element.classList.add(SHOWN_SNIPPET_CLASS);
    if (isListItemElement(element)) {
      var children = element.childNodes;
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (!isSnippet(child)) {
          child.classList.remove(HIDDEN_SNIPPET_CLASS);
        }
      }
    }
    element.addEventListener("click", hideBetweenSnippets, false);
    element = getPreviousSibling(element);
  }
  e.currentTarget.parentNode.removeChild(e.currentTarget);
}

var getPreviousSibling = function (element) {
  if (!element.previousSibling && isListItemElement(element)) {
    element = element.parentElement.previousSibling;
  } else {
    element = element.previousSibling;
  }
  return element;
};

var getNextSibling = function (element) {
  if (!element.nextSibling && isListItemElement(element)) {
    element = element.parentElement.nextSibling;
  } else {
    element = element.nextSibling;
  }
  return element;
};

function hideBetweenSnippets(e) {
  e.preventDefault();
  e.stopPropagation();
  var startElement = e.currentTarget;
  var nodes = [];
  nodes.push(startElement);
  var upElement = getPreviousSibling(startElement);
  while (upElement && !isSnippet(upElement)) {
    if (isListElement(upElement)) {
      upElement = upElement.lastChild;
      continue;
    }
    nodes.push(upElement);
    upElement = getPreviousSibling(upElement);
  }
  var downElement = getNextSibling(startElement);

  while (downElement && !isSnippet(downElement)) {
    if (isListElement(downElement)) {
      downElement = downElement.firstChild;
      continue;
    }
    nodes.push(downElement);
    downElement = getNextSibling(downElement);
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

var annotateAsSnippet = function (element) {
  if (element) {
    element.setAttribute("snippet", "true");
  }
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
    var mcidRegex = /mcid="[\d\/]+"/g;
    var mcIds = match.match(mcidRegex);
    var parentElement = null;
    for (var j = 0; j < mcIds.length; j++) {
      var selector = '[' + mcIds[j] + ']';
      var elements = document.querySelectorAll(selector);
      var element = elements[0];
      applyProblemClassToElement(problemType, element);
      parentElement = element.parentElement;
      annotateAsSnippet(parentElement);
      if (parentElement.tagName.toLowerCase() === "lbody") {
        var lblElement = parentElement.previousSibling;
        annotateAsSnippet(lblElement);
        var liElement = parentElement.parentElement;
        annotateAsSnippet(liElement);
      }
      pdfViewer.markValidationError(mcIds[j], problemType);
    }
    if (parentElement) {
      addMessage(parentElement, problemType, problemMessage);
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
