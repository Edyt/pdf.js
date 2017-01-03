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
